/* ============================================================================
   PPP practice policy v1 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.3, G11-D8; phase G11b-2)

   A UMD module (Node + browser; global PPPPolicy). Pure and deterministic: the same (model, time, state, context) gives the
   same decision; no clock, no Math.random. It reads the learner model of practice/learner.js and answers, after every lap,
   WHAT TO PLAY NEXT - in the Coach plan schema (G11-D8: range, hand, tempoPercent, mode, repetitions, reason), so the app's
   own Coach.validate stays the only door (the page passes every plan through it, `checked` below; G11b-3).

   It never invents music: a task names bars of the piece (its measure numbers, a contiguous run of measure INDEXES), a hand
   that has notes there, a tempo step of the ladder (40-100 % of the score tempo) and a mode the app has; memory work only on
   a section the app's own Memory.eligible gate has opened (Coach.context's allowed.memoryEligibleSections).

   The rules, in order (§7.3):
     1. a new session starts with a SPACED RE-CHECK of the bars whose review box is due (one lap of the smallest window that
        holds them, at the score tempo, hands together);
     1b. a piece of which at least readShare of the notes was never measured is READ THROUGH once first (the legacy "play it once
        so PPP can find your weak spots"), at the fastest step the model expects to go;
     2. a due MEMORY REVIEW of the page's memory record (the legacy rule: a severe technical weakness first);
     3. the WEAKEST PASSAGE by value per second: every contiguous window of up to maxLen bars is scored by the expected
        shortfall of its notes below `target` accuracy at the score tempo (E[max(0, target - accuracy)] under the model's
        uncertainty: a bar the model knows little about has a shortfall even when its mean is fine, so it gets looked at),
        divided by the seconds a lap of it takes plus the time between laps (and the time to change the task when it is a
        new one). Long windows when much is unknown (the first reading is the whole piece), short ones on the last weak bars;
     4. within a passage, the TEMPO LADDER: start at the fastest step where the predicted accuracy is >= startAcc (never
        below floorPct), one step up after upLaps laps >= upAcc, one down after downLaps laps <= downAcc, never above topPct.
        A step is a SUGGESTION (U6: the automatic toggle is off by default; `autoTempo` marks it so);
     5. HANDS SEPARATELY when the model's hand gap in the passage is >= handGap over >= handRuns runs and the weaker hand is
        below aloneBelow: the weaker hand alone for aloneLaps laps, then hands together at the same tempo;
     6. MOVE ON after at least minDwell laps on a passage when another window is worth switchGain more per second (or the
        passage is clean): the STABILITY rule (§7.3), which keeps the advice from flipping (<= 1 change of passage per 3 laps);
     7. nothing weak: MEMORY WORK where the gate allows it (unchanged), otherwise a run-through of the piece at the score
        tempo (keeps every bar in practice);
     8. STUCK detection (input to G11c, never acted on here): a passage chosen in >= stuckSessions sessions whose shortfall
        has not gone down, at <= stuckPct tempo, is flagged.

   The numbers (DEFAULTS) were set on the simulator's tuning set only (G11 §20, tests/practice-sim/policy-tune.js); where the
   simulator and the design disagree the design was kept and the price is reported there (the synthetic learners reward
   playing everything at the score tempo; the ladder and hands separately are kept, and rarely fire on them).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./learner.js'), root);
  else root.PPPPolicy = factory(root.PPPLearner, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Learner, root) {
  'use strict';

  const VERSION = 1;
  const MIN = 60000;
  /* in a page practice/learner.js may arrive after this file */
  const learnerOf = () => Learner || (root && root.PPPLearner);

  /* Set on the simulator's tuning set (G11 §20). lapSec/changeSec are what the policy assumes a lap and a change of task cost
     the person on top of the music (it cannot know them; the simulator's person spends 4 s and 6 s). */
  const DEFAULTS = Object.freeze({
    target: 0.9,
    need: 'shortfall',        /* 'shortfall': E[max(0, target - accuracy)]; 'below': P(accuracy < target) */
    review: true,             /* the spaced re-check at the start of a session */
    readShare: 0.5,           /* when at least this share of the notes has never been measured, read the unmeasured stretch through first */
    maxLen: 16,
    lapSec: 4, changeSec: 6,
    minDwell: 3, switchGain: 0,
    startAcc: 0.5, floorPct: 40, topPct: 100, stepUp: 10, stepDown: 10,
    upAcc: 0.85, upLaps: 2, downAcc: 0.5, downLaps: 2,
    handGap: 0.15, handRuns: 1, aloneBelow: 0.7, aloneLaps: 2,
    timingMs: 180,
    severeAcc: 0.6,
    cleanP: 0.8,
    reviewMaxShare: 1,        /* a re-check window may be the whole piece */
    throughReps: 3, memoryReps: 3,
    sessionGapMin: 60,
    stuckSessions: 3, stuckPct: 60, stuckGain: 0.1,
    autoTempo: false
  });

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function opt(o) { return Object.assign({}, DEFAULTS, o || {}); }

  function initState() {
    return { v: VERSION, focus: null, lastAt: null, seenAt: null, session: 0, stuck: {} };
  }
  function cloneState(s) { return s ? JSON.parse(JSON.stringify(s)) : initState(); }

  /* ---------------------------------------------------------------- what the model says, once per decision */
  function snapshot(model, t, P, L, ignoreUncertainty) {
    const n = model.measures.length;
    const pl = L.pools(model, t);
    const need = new Float64Array(n), sec = new Float64Array(n), pM = new Array(n), notes = new Int32Array(n);
    const spb = 60 / model.scoreTempo;
    for (let i = 0; i < n; i++) {
      const m = model.measures[i];
      notes[i] = m.r.n + m.l.n;
      sec[i] = m.q * spb;
      if (!notes[i]) { pM[i] = null; continue; }
      need[i] = P.need === 'below' ? L.belowTarget(model, i, P.target, t, pl, ignoreUncertainty) : L.shortfall(model, i, P.target, t, pl, ignoreUncertainty);
      pM[i] = L.pAtLeast(model, i, model.params.masteryAcc, model.params.masteryRatio, t, pl);
    }
    return { n, pl, need, sec, pM, notes, t };
  }
  const num = (model, i) => model.measures[i].number;

  /* the window [a, b] worth most per second (ties: the earlier, then the shorter); exclude: a window not to return */
  function bestWindow(model, snap, P, cur, exclude) {
    let best = null;
    for (let a = 0; a < snap.n; a++) {
      let s = 0, d = 0;
      for (let b = a; b < Math.min(snap.n, a + P.maxLen); b++) {
        s += snap.need[b]; d += snap.sec[b];
        if (!(s > 1e-9)) continue;
        if (num(model, a) > num(model, b)) continue;
        const same = !!cur && cur.a === a && cur.b === b;
        if (exclude && exclude.a === a && exclude.b === b) continue;
        const v = s / (d + P.lapSec + (same ? 0 : P.changeSec));
        if (!best || v > best.v + 1e-12) best = { a: a, b: b, v: v, need: s };
      }
    }
    return best;
  }
  function windowValue(snap, P, a, b, same) {
    let s = 0, d = 0;
    for (let i = a; i <= b; i++) { s += snap.need[i]; d += snap.sec[i]; }
    return s / (d + P.lapSec + (same ? 0 : P.changeSec));
  }
  function windowNeed(snap, a, b) { let s = 0; for (let i = a; i <= b; i++) s += snap.need[i]; return s; }

  /* the predicted share of the window's notes (both hands, or one) at a tempo ratio */
  function windowAcc(model, snap, a, b, ratio, hands, L) {
    let s = 0, n = 0;
    for (let i = a; i <= b; i++) {
      const m = model.measures[i];
      const k = hands === 'left' ? m.l.n : hands === 'right' ? m.r.n : m.r.n + m.l.n;
      if (!k) continue;
      s += k * L.predictMeasure(model, i, { ratio: ratio, hands: hands }, snap.t, snap.pl);
      n += k;
    }
    return n ? s / n : null;
  }
  function handAcc(model, snap, a, b, hand, ratio, L) {
    let s = 0, n = 0, runs = Infinity;
    for (let i = a; i <= b; i++) {
      const it = model.measures[i][hand];
      if (!it.n) continue;
      const z = L.itemZ(model, i, hand, { ratio: ratio, alone: false }, snap.t, snap.pl);
      s += it.n * L.meanSigma(z.m, z.v); n += it.n;
      runs = Math.min(runs, it.runs);
    }
    return n ? { acc: s / n, notes: n, runs: runs } : null;
  }
  function windowTiming(model, a, b) {
    let s = 0, n = 0;
    for (let i = a; i <= b; i++) ['r', 'l'].forEach(h => { const it = model.measures[i][h]; if (it.n && it.tn) { s += it.ta * it.tn; n += it.tn; } });
    return n ? s / n : null;
  }

  function startPct(model, snap, P, a, b, L) {
    for (let pct = P.topPct; pct >= P.floorPct; pct -= 5) {
      const acc = windowAcc(model, snap, a, b, pct / 100, 'both', L);
      if (acc == null || acc >= P.startAcc) return pct;
    }
    return P.floorPct;
  }

  /* ---------------------------------------------------------------- choosing a new task */
  function newFocus(model, snap, P, L, kind, a, b) {
    let pct = startPct(model, snap, P, a, b, L);
    const tim = windowTiming(model, a, b);
    if (tim != null && tim >= P.timingMs && pct > P.floorPct) pct = Math.max(P.floorPct, pct - P.stepDown);
    let hands = 'both', alone = 0;
    const r = handAcc(model, snap, a, b, 'r', pct / 100, L), l = handAcc(model, snap, a, b, 'l', pct / 100, L);
    if (r && l && r.runs >= P.handRuns && l.runs >= P.handRuns && Math.abs(r.acc - l.acc) >= P.handGap && Math.min(r.acc, l.acc) < P.aloneBelow) {
      hands = r.acc < l.acc ? 'right' : 'left';
      alone = P.aloneLaps;
    }
    return { kind: kind, a: a, b: b, hands: hands, pct: pct, mode: 'practice', laps: 0, alone: alone, up: 0, down: 0, reps: P.minDwell,
      why: hands !== 'both' ? (hands === 'left' ? 'left' : 'right') : pct < 100 ? 'slow' : 'weak' };
  }

  /* is a memory task still behind the app's own gate (Memory.eligible, through Coach.context)? */
  function memoryOpen(ctx, from) {
    const ok = (ctx && ctx.allowed && ctx.allowed.memoryEligibleSections) || [];
    return ok.some(s => from >= s.from && from <= s.to);
  }

  function idxOfNumber(model, number) {
    for (let i = 0; i < model.measures.length; i++) if (model.measures[i].number === number) return i;
    return -1;
  }

  /* the page's memory picture, from Coach.context (lazy: asked for only when a memory decision is near) */
  function memoryChoice(model, P, ctx, severe) {
    if (!ctx || !ctx.memory || !ctx.allowed) return null;
    const ok = ctx.allowed.memoryEligibleSections || [];
    const inGate = from => ok.some(s => from >= s.from && from <= s.to);
    const span = (from, to) => { const a = idxOfNumber(model, from), b = idxOfNumber(model, to); return a >= 0 && b >= a ? { a, b } : null; };
    if (!severe) {
      const due = (ctx.memory.dueReviews || []).filter(d => d.from != null && inGate(d.from))[0];
      const w = due && span(due.from, due.to);
      if (w) return { kind: 'memory', a: w.a, b: w.b, from: due.from, to: due.to, hands: 'both', pct: 100, mode: 'memory', laps: 0, reps: 1, why: 'review' };
    }
    return null;
  }
  function memoryWork(model, P, ctx) {
    if (!ctx || !ctx.memory || !ctx.allowed) return null;
    const ok = ctx.allowed.memoryEligibleSections || [];
    const sec = (ctx.memory.sections || []).filter(s => (s.state === 'memory-ready' || s.state === 'memorizing') && ok.some(g => s.from >= g.from && s.from <= g.to))[0];
    if (!sec) return null;
    const a = idxOfNumber(model, sec.from), b = idxOfNumber(model, sec.to);
    if (a < 0 || b < a) return null;
    return { kind: 'memory', a: a, b: b, from: sec.from, to: sec.to, hands: 'both', pct: 100, mode: 'memory', laps: 0, reps: P.memoryReps, why: 'memory' };
  }

  function choose(model, snap, P, st, newSession, ctxOf, L) {
    const n = snap.n;
    /* 1. the spaced re-check */
    if (newSession && P.review) {
      const due = L.due(model, snap.t);
      if (due.length) {
        let a = due[0], b = due[due.length - 1];
        if (num(model, a) > num(model, b)) { a = 0; b = n - 1; }
        if ((b - a + 1) <= Math.max(1, Math.ceil(n * P.reviewMaxShare))) {
          return { kind: 'review', a: a, b: b, hands: 'both', pct: 100, mode: 'practice', laps: 0, reps: 1, why: 'review' };
        }
      }
    }
    /* the first reading (the legacy "play it once so PPP can find your weak spots"): one lap over every bar nobody has measured */
    if (P.readShare < 1) {
      let tot = 0, un = 0, a = -1, b = -1;
      for (let i = 0; i < n; i++) {
        if (!snap.notes[i]) continue;
        tot += snap.notes[i];
        const m = model.measures[i];
        if (!m.r.runs && !m.l.runs) { un += snap.notes[i]; if (a < 0) a = i; b = i; }
      }
      if (tot && un / tot >= P.readShare && a >= 0 && num(model, a) <= num(model, b)) {
        return { kind: 'read', a: a, b: b, hands: 'both', pct: startPct(model, snap, P, a, b, L), mode: 'practice', laps: 0, reps: 1, why: 'read' };
      }
    }
    let severe = false, allClean = true;
    for (let i = 0; i < n; i++) {
      if (!snap.notes[i]) continue;
      if (!(snap.pM[i] >= P.cleanP)) allClean = false;
      const m = model.measures[i];
      if ((m.r.runs || m.l.runs) && L.predictMeasure(model, i, { ratio: 1, hands: 'both' }, snap.t, snap.pl) < P.severeAcc) severe = true;
    }
    /* 2. a due memory review (a severe weakness first) */
    const memReview = ctxOf ? memoryChoice(model, P, ctxOf(), severe) : null;
    if (memReview) return memReview;
    /* 3. the weakest passage */
    if (!allClean) {
      const w = bestWindow(model, snap, P, null, null);
      if (w) return newFocus(model, snap, P, L, 'focus', w.a, w.b);
    }
    /* 7. memory work, else a run-through */
    const mw = ctxOf ? memoryWork(model, P, ctxOf()) : null;
    if (mw) return mw;
    let a = 0, b = n - 1;
    while (a < b && !snap.notes[a]) a++;
    while (b > a && !snap.notes[b]) b--;
    if (num(model, a) > num(model, b)) { a = 0; b = 0; }
    return { kind: 'through', a: a, b: b, hands: 'both', pct: 100, mode: 'practice', laps: 0, reps: P.throughReps, why: 'through' };
  }

  /* ---------------------------------------------------------------- the decision after a lap */
  const REASON = {
    review: 'Spaced review: these bars were clean before - check that they still are.',
    read: 'Play it through once so PPP can find your weak spots.',
    weak: 'The weakest passage now: hands together.',
    slow: 'The weakest passage now: hands together, slower, so that most notes land.',
    left: 'Left hand alone first: it is behind the right hand here.',
    right: 'Right hand alone first: it is behind the left hand here.',
    both: 'Now hands together at the same tempo.',
    up: 'Clean at this tempo: one step faster.',
    down: 'Too many notes are lost: one step slower.',
    memory: 'Steady enough to work from memory.',
    through: 'Everything you have practised is holding: play it through to keep it.'
  };

  function taskOf(model, f) {
    const start = f.mode === 'memory' && f.from != null ? f.from : num(model, f.a);
    const end = f.mode === 'memory' && f.to != null ? f.to : num(model, f.b);
    return {
      range: { start: start, end: end }, hand: f.hands, tempoPercent: f.pct, mode: f.mode,
      repetitions: clamp(Math.round(Math.max(1, (f.reps || 1) - (f.laps || 0))), 1, 8),
      reason: REASON[f.why] || REASON.weak
    };
  }
  function sameTask(t, cur) {
    return !!cur && cur.from === t.range.start && cur.to === t.range.end && cur.hands === t.hand &&
      Math.round(cur.tempoPct) === t.tempoPercent && (cur.mode || 'practice') === t.mode;
  }

  /* model: practice/learner.js; t: now (ms); st0: the policy's state (initState() at first); io: {current: what the page is set
     to {from, to, hands, tempoPct, mode} (measure numbers), ctx: Coach.context or a function returning it (read only for memory
     decisions), opts: parameters}. -> {task, changed, suggestion, kind, state, stuck}. The input state is not changed. */
  function decide(model, t, st0, io) {
    const L = learnerOf();
    io = io || {};
    const P = opt(io.opts);
    const st = cloneState(st0);
    const ctxOf = typeof io.ctx === 'function' ? io.ctx : io.ctx ? () => io.ctx : null;
    const newSession = st.lastAt == null || t - st.lastAt >= P.sessionGapMin * MIN;
    let f = newSession ? null : st.focus;
    if (newSession) st.session++;
    /* the lap just played, as the model read it */
    const lr = model.lastRun;
    let stepped = null;
    if (f && lr && lr.at > (st.seenAt == null ? -Infinity : st.seenAt)) {
      let k = 0, e = 0;
      (lr.per || []).forEach(([j, acc, ej]) => { if (j >= f.a && j <= f.b && acc != null) { k += acc * ej; e += ej; } });
      const acc = e ? k / e : null;
      f.laps++;
      if (acc != null) {
        if (acc >= P.upAcc) { f.up++; f.down = 0; } else if (acc <= P.downAcc) { f.down++; f.up = 0; } else { f.up = 0; f.down = 0; }
      }
    }
    if (lr) st.seenAt = lr.at;
    st.lastAt = t;
    const snap = snapshot(model, t, P, L, !!io.ignoreUncertainty);
    if (f) {
      if (f.kind === 'focus') {
        if (f.alone > 0 && f.hands !== 'both' && f.laps >= f.alone) { f.hands = 'both'; f.up = 0; f.down = 0; f.why = 'both'; stepped = 'hands'; }
        else if (f.up >= P.upLaps && f.pct < P.topPct) { f.pct = Math.min(P.topPct, f.pct + P.stepUp); f.up = 0; f.why = 'up'; stepped = 'tempo'; }
        else if (f.down >= P.downLaps && f.pct > P.floorPct) { f.pct = Math.max(P.floorPct, f.pct - P.stepDown); f.down = 0; f.why = 'down'; stepped = 'tempo'; }
        if (!stepped && f.laps >= P.minDwell) {
          const vc = windowValue(snap, P, f.a, f.b, true);
          const best = bestWindow(model, snap, P, f, f);
          if (!(windowNeed(snap, f.a, f.b) > 1e-6) || (best && best.v > vc * (1 + P.switchGain))) f = null;
        }
      } else if (f.laps >= f.reps) f = null;
      /* a memory task whose section the gate has closed again (a failed lap can do that) is not asked for */
      else if (f.mode === 'memory' && (!ctxOf || !memoryOpen(ctxOf(), f.from))) f = null;
    }
    let fresh = false;
    if (!f) { f = choose(model, snap, P, st, newSession, ctxOf, L); fresh = true; }
    st.focus = f;
    /* stuck detection (§7.3 item 6): a flag for G11c, nothing more */
    let stuck = null;
    if (fresh && f.kind === 'focus') {
      const key = f.a + '-' + f.b;
      const rec = st.stuck[key] || (st.stuck[key] = { sessions: [], need0: windowNeed(snap, f.a, f.b) });
      if (rec.sessions.indexOf(st.session) < 0) rec.sessions.push(st.session);
      if (rec.sessions.length > 8) rec.sessions = rec.sessions.slice(-8);
      if (rec.sessions.length >= P.stuckSessions && f.pct <= P.stuckPct && windowNeed(snap, f.a, f.b) >= rec.need0 * (1 - P.stuckGain)) {
        stuck = { from: num(model, f.a), to: num(model, f.b) };
      }
      const keys = Object.keys(st.stuck);
      if (keys.length > 32) delete st.stuck[keys[0]];
    }
    const task = taskOf(model, f);
    const changed = !sameTask(task, io.current);
    return {
      task: task, changed: changed, kind: f.kind,
      suggestion: changed && stepped === 'tempo' && !P.autoTempo,
      state: st, stuck: stuck
    };
  }

  /* The session plan from here, in the Coach schema (what the coach card shows; every task passes Coach.validate): the task
     of the decision, then what the rules will most likely ask next on the same passage, then the next passage. */
  function plan(model, t, st, ctx, o) {
    const L = learnerOf();
    const P = opt(o);
    const f = st && st.focus;
    const snap = snapshot(model, t, P, L, false);
    const tasks = [];
    const add = task => { if (tasks.length < 4 && !tasks.some(x => JSON.stringify(x) === JSON.stringify(task))) tasks.push(task); };
    if (f) {
      add(taskOf(model, f));
      if (f.kind === 'focus') {
        if (f.hands !== 'both') add(taskOf(model, Object.assign({}, f, { hands: 'both', laps: 0, reps: 2, why: 'both' })));
        let pct = f.pct;
        while (pct < P.topPct && tasks.length < 3) {
          pct = Math.min(P.topPct, pct + P.stepUp);
          add(taskOf(model, Object.assign({}, f, { hands: 'both', pct: pct, laps: 0, reps: P.upLaps, why: 'up' })));
        }
      }
    }
    const next = bestWindow(model, snap, P, f, f);
    if (next) add(taskOf(model, newFocus(model, snap, P, L, 'focus', next.a, next.b)));
    if (!tasks.length) add(taskOf(model, choose(model, snap, P, initState(), false, ctx ? () => ctx : null, L)));
    /* memory work only where the gate is open (the plan never asks for what Coach.validate would drop) */
    for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].mode === 'memory' && !memoryOpen(ctx, tasks[i].range.start)) tasks.splice(i, 1);
    if (!tasks.length) {
      let a = 0, b = snap.n - 1;
      while (a < b && !snap.notes[a]) a++;
      while (b > a && !snap.notes[b]) b--;
      if (num(model, a) > num(model, b)) b = a;
      add(taskOf(model, { kind: 'through', a: a, b: b, hands: 'both', pct: 100, mode: 'practice', laps: 0, reps: P.throughReps, why: 'through' }));
    }
    const minutes = clamp(Math.round(tasks.reduce((s, x) => s + x.repetitions * 0.5, 0)), 5, 60);
    return {
      summary: 'PPP chose these from your recorded runs.',
      todayGoal: 'Practise the weakest passage until it is clean.',
      tasks: tasks, coachNote: '', sessionMinutes: minutes
    };
  }

  /* The only door (G11-D8): a plan is shown or played only as Coach.validate returns it. validate: the app's Coach.validate.
     -> {ok, plan, issues}; a plan that does not pass is not used (the caller falls back to the deterministic plan). */
  function checked(p, ctx, validate) {
    if (typeof validate !== 'function') return { ok: false, plan: null, issues: [{ level: 'reject', message: 'no validator' }] };
    const r = validate(JSON.parse(JSON.stringify(p)), ctx);
    if (!r || !r.ok || !r.plan) return { ok: false, plan: null, issues: (r && r.issues) || [] };
    return { ok: true, plan: r.plan, issues: r.issues || [] };
  }

  return Object.freeze({
    VERSION, DEFAULTS, REASON, initState, decide, plan, checked,
    _internal: { snapshot, bestWindow, windowValue, windowAcc, startPct, newFocus, choose, taskOf, sameTask }
  });
});
