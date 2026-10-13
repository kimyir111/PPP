/* G11a-4: the probes of tests/practice/options.js that run INSIDE the app's page (added with addScriptTag after canon.js and switch-page.js). A plain script: it sets window.PPPOptionsProbe.

   Every probe takes plain data and returns plain data. They switch PPP.practice and PPP.practiceFix themselves and put both back (legacy, on). What they look at is the plan the PAGE
   hands the player (PPP.practicePlan) with the four fixes on (jumps, graces, repeats, ties), the matcher (the real PerformanceEngine), follow mode's gates (the app's own followGates), the
   real scheduler on a fake piano and fake MIDI output (PPPSwitchProbe.runCase) and the falling notes (PPP.PianoVisual.scoreToTimeline).

     choice()               PPP.practiceFix: the default, what is no choice, the list form, what is remembered, and that 'legacy' never reads it
     plan(item, o)          the plan of a piece with the fixes on against the legacy plan and against practice/plan.js built directly: visits, length, jumps, graces, notes
     lap(item)              loop windows and Start-to-finish laps: longer when a jump is inside the window, the legacy lap when it is not
     matcher(item, o)       scripted performances: graces are not expected, a played grace is not wrong, graces on or off the verdicts are the same; a repeat is two visits of one bar
     gates(item)            follow mode asks exactly the notes Play strikes, in the order Play plays them (repeats and ties on), and what each option alone does
     spies(item)            the real scheduler: every strike is queued once (graces included), a lap is the plan's length
     visual(item)           the falling notes: every strike is a note, a grace is flagged and short, a tie cut at a jump is drawn cut
     fixture(item)          the tie at a jump on the hand-written D.S. al Coda piece: the page's plan, the matcher, the gates, the falling notes
     fallbacks()            a piece the plan cannot be made for keeps the legacy plan with the fixes on, counted
     perf(item)             the plan with the fixes on costs no more than the legacy build plus a quarter; asking again is the same object
     sim(item)              the simulation without a keyboard judges the notes the matcher would, and a run keeps its plan
     switching(item)        a change of PPP.practiceFix is seen by the next plan and by follow mode's gates (their cache keys)
     hint(item)             the keyboard hint shows the note a tie leads into from nowhere
     run(item)              the transport itself (advance on a clock of the probe's own): the playhead walks the plan's visits, a lap is its length, a loop starts over at its first bar
     resume(item)           a pause in a bar the plan plays twice is resumed in that visit (transport, falling notes, matcher); under 'legacy' as ever, the first
     sweep(items)           every file of a corpus: planned from the graph (no fallback), Play = Follow, the counts per cause */
(function () {
  'use strict';
  const C = window.PPPPracticeCanon, PPP = window.PPP, Score = PPP.Score, SW = window.PPPSwitchProbe;
  const J = JSON.stringify, r6 = C.r6;
  const msg = e => String(e && (e.message || e) || e).slice(0, 160);
  const proto = Object.getPrototypeOf(PPP.app);
  const handOk = (n, h) => (n.hand === 'x' ? false : !h || h === 'both' || (h === 'right' ? n.hand === 'r' : n.hand === 'l'));

  /* graph mode with a given set of fixes, for the duration of fn; what was there before is put back (a probe nests them) */
  async function inMode(fix, fn) {
    const before = [PPP.practice, PPP.practiceFix];
    PPP.practice = 'graph';
    PPP.practiceFix = fix;
    await PPP.loadPracticeModule();
    try { return await fn(); } finally { PPP.practice = before[0]; PPP.practiceFix = before[1]; }
  }
  function inModeSync(fix, fn) {
    const before = [PPP.practice, PPP.practiceFix];
    PPP.practice = 'graph';
    PPP.practiceFix = fix;
    try { return fn(); } finally { PPP.practice = before[0]; PPP.practiceFix = before[1]; }
  }
  const wholeOf = score => ({ from: Score.first(score), to: Score.last(score) });
  const countBy = (list, f) => list.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
  /* a multiset as a sorted list of keys joined: equal multisets are equal strings */
  const bag = keys => keys.slice().sort().join(';');

  /* ---- PPP.practiceFix ---- */
  async function choice() {
    const out = {};
    const key = () => { try { return localStorage.getItem('ppp.practiceFix.v1'); } catch (e) { return 'throws'; } };
    out.initial = [PPP.practiceFix, key()];
    out.seq = [];
    ['off', 'jumps,ties', 'ties,jumps', 'graces', 'jumps,graces,repeats,ties', 'on', 'junk', 'jumps,junk', 'ON', '', ' jumps', 'jumps,jumps'].forEach(v => {
      PPP.practiceFix = v;
      out.seq.push([v, PPP.practiceFix, key()]);
    });
    /* a value that is no choice puts the default back and forgets the remembered one */
    PPP.practiceFix = 'off';
    PPP.practiceFix = null;
    out.forgot = [PPP.practiceFix, key()];
    PPP.practiceFix = 'on';
    /* 'legacy' is the player it was whatever the fixes say: the very object, no graph, nothing counted */
    const sc = await SW.loadScore({ file: 'catalog/hymns/all-creatures.musicxml' });
    PPP.practice = 'legacy';
    const g0 = PPP.practiceStats.graph;
    out.legacy = ['on', 'off', 'jumps,graces'].map(f => { PPP.practiceFix = f; return PPP.practicePlan(sc) === PPP.PianoScore.of(sc) && !PPP.practicePlan(sc).graph; });
    out.legacyCounted = PPP.practiceStats.graph - g0;
    PPP.practiceFix = 'on';
    return out;
  }

  /* ---- the plan the page hands the player ---- */
  async function plan(item, o) {
    o = o || {};
    const rec = { file: item.file, fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    const legacy = PPP.PianoScore.of(score, w.from, w.to);
    rec.legacy = { visits: legacy.visits.length, len: legacy.soundLengthQ, strikes: legacy.strikes.length };
    await inMode(o.fix || 'on', async () => {
      const f0 = PPP.practiceStats.practiceFallback.total, st0 = JSON.parse(JSON.stringify(PPP.practiceStats));
      const p = PPP.practicePlan(score, w.from, w.to);
      rec.graph = !!p.graph;
      rec.fallbacks = PPP.practiceStats.practiceFallback.total - f0;
      rec.visits = p.visits.length;
      rec.len = p.soundLengthQ;
      rec.strikes = p.strikes.filter(s => !s.grace).length;
      rec.graces = p.strikes.filter(s => s.grace).length;
      rec.graceEvents = new Set(p.strikes.filter(s => s.grace).map(s => s.ev)).size;
      rec.jumps = (p.jumps || []).map(j => j.kind);
      rec.arrivals = countBy(p.visits, v => v.jumped);
      rec.stats = { graph: PPP.practiceStats.graph - st0.graph, jumps: PPP.practiceStats.jumps - st0.jumps, graces: PPP.practiceStats.graces - st0.graces };
      rec.same = PPP.practicePlan(score, w.from, w.to) === p;
      /* the page's plan is practice/plan.js built directly with the same options (the page adds only the Score's own notes) */
      const src = window.PPPEngrave.app.resolveSync(score);
      const fx = String(PPP.practiceFix === 'on' ? 'jumps,graces,repeats,ties' : PPP.practiceFix === 'off' ? '' : PPP.practiceFix).split(',');
      const direct = window.PPPPractice.plan.build(src.graph, { range: { from: 0, to: score.measures.length - 1 }, defaultQpm: +score.tempo > 0 ? +score.tempo : 84, legacyCompat: true,
        jumps: fx.indexOf('jumps') >= 0 ? 'once' : false, graces: fx.indexOf('graces') >= 0 ? 'play' : false });
      rec.sameAsBuild = J(C.planOf(p)) === J(C.planOf(direct)) && p.strikes.every((s, i) => s.heldQ === direct.strikes[i].heldQ && !!s.grace === !!direct.strikes[i].grace);
      const set = new Set(score.notes);
      rec.notesOk = p.strikes.every(s => (s.grace ? !!(s.note && s.note.grace && s.note.hand) : set.has(s.note)));
      rec.graceNotAsked = (() => {
        const eng = new PPP.PerformanceEngine(score);
        eng.begin({ from: w.from, to: w.to, hands: 'both', tempo: score.tempo || 84, startedAt: 0 });
        const want = p.strikes.filter(s => !s.grace && handOk(s.note, 'both')).length;
        return eng.expected.length === want && eng.expected.every(x => !x.note.grace);
      })();
    });
    return rec;
  }

  /* ---- laps: whole piece and loop windows ---- */
  async function lap(item) {
    const rec = { file: item.file, fail: [], windows: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    await inMode('on', async () => {
      const whole = PPP.practicePlan(score, w.from, w.to);
      const lw = PPP.PianoScore.of(score, w.from, w.to);
      rec.whole = { legacy: lw.soundLengthQ, graph: whole.soundLengthQ, jumps: whole.jumps.length };
      if (!whole.jumps.length) return;
      const ms = score.measures;
      /* every jump the plan followed: the bar with the sign (the visit it was taken at) and the bar it turned to */
      whole.jumps.forEach(j => {
        const sign = whole.visits[j.from].index, target = j.to;
        const lo = Math.min(sign, target), hi = Math.max(sign, target);
        const inside = { from: ms[lo].number, to: ms[hi].number };
        /* a To Coda is only taken on the way back of a D.S., so its own window (the sign and the coda) holds no way back: not tested here, the fixture's windows hold the D.S. as well */
        if (j.kind !== 'tocoda') {
          const a = PPP.practicePlan(score, inside.from, inside.to), b = PPP.PianoScore.of(score, inside.from, inside.to);
          rec.windows.push({ kind: j.kind, what: 'sign and target inside', from: inside.from, to: inside.to, legacy: b.soundLengthQ, graph: a.soundLengthQ, visitsLegacy: b.visits.length, visits: a.visits.length, jumps: a.jumps.length });
        }
        /* the sign's own bar alone: nothing to turn to inside it */
        const alone = PPP.practicePlan(score, ms[sign].number, ms[sign].number), aloneL = PPP.PianoScore.of(score, ms[sign].number, ms[sign].number);
        rec.windows.push({ kind: j.kind, what: 'sign alone', from: ms[sign].number, to: ms[sign].number, legacy: aloneL.soundLengthQ, graph: alone.soundLengthQ, jumps: alone.jumps.length,
          same: J(C.planOf(alone)) === J(C.planOf(aloneL)) });
      });
    });
    return rec;
  }

  /* ---- the matcher ---- */
  async function matcher(item, o) {
    o = o || {};
    const rec = { file: item.file, runs: 0, fail: [], graceStrikes: 0, repeatedBars: 0 };
    const score = await SW.loadScore(item);
    const first = Score.first(score), last = Score.last(score), base = score.tempo || 84;
    const wins = C.windows(score, o.windows || 1, C.cyrb64(item.file)[1]);
    const ranges = [{ from: first, to: last }].concat(wins);
    const begin = (fix, r, hands) => inModeSync(fix, () => {
      const eng = new PPP.PerformanceEngine(score);
      eng.begin({ from: r.from, to: r.to, hands: hands, tempo: base, startedAt: 0 });
      return eng;
    });
    await inMode('on', async () => {});            /* the module is here before the first plan */
    for (const r of ranges) for (const hands of ['both', 'right', 'left']) {
      const name = '[' + r.from + '..' + r.to + '] ' + hands;
      const A = begin('on', r, hands), plan = A._plan;
      rec.runs++;
      if (!plan.graph) { rec.fail.push(name + ': no graph plan'); continue; }
      const strikes = plan.strikes, graces = strikes.filter(s => s.grace && handOk(s.note, hands));
      rec.graceStrikes += graces.length;
      const want = strikes.filter(s => !s.grace && handOk(s.note, hands));
      if (A.expected.length !== want.length) rec.fail.push(name + ': ' + A.expected.length + ' expected notes, the plan strikes ' + want.length + ' that are not graces');
      if (A.expected.some(x => x.note && x.note.grace)) rec.fail.push(name + ': a grace note is expected');
      if (J(A.graces.map(g => g.midi)) !== J(graces.map(g => g.midi))) rec.fail.push(name + ': the engine does not know the plan\'s graces');
      /* the visit of every expected note: its place in the plan's visits, and the bar it plays */
      const visitOk = A.expected.every(x => { const k = A.visitOf(x); return Number.isInteger(k) && plan.visits[k] && plan.visits[k].index === x.mIdx; });
      if (!visitOk) rec.fail.push(name + ': an expected note names a visit that is not the bar it is in');
      const visitsOf = new Map();
      A.expected.forEach(x => { if (!visitsOf.has(x.mIdx)) visitsOf.set(x.mIdx, new Set()); visitsOf.get(x.mIdx).add(A.visitOf(x)); });
      visitsOf.forEach(s => { if (s.size > 1) rec.repeatedBars++; });
      /* a perfect performance matches everything, wrong and extra are nothing */
      const resA = C.replay(A, C.streamEvents(A.expected, 'perfect'));
      if (resA.counts.matched !== resA.counts.expected || resA.counts.wrong || resA.counts.extra || resA.counts.missed) rec.fail.push(name + ': a perfect performance is not perfect: ' + J(resA.counts));
      /* the same performance and the graces played too: neither a wrong note nor an extra one, the verdicts the same */
      const B = begin('on', r, hands);
      const ev = C.streamEvents(B.expected, 'perfect').concat(B.graces.map(g => ({ midi: g.midi, t: g.tMs })));
      ev.sort((a, b) => a.t - b.t || a.midi - b.midi);
      const resB = C.replay(B, ev);
      /* a grace on the pitch of a note that is asked within the window is the same key to the matcher (the nearest asked note takes it): the verdicts may then differ in timing, not in notes */
      const ambiguous = B.graces.some(g => B.expected.some(x => x.midi === g.midi && Math.abs(x.tMs - g.tMs) <= B.timing.window));
      if (!ambiguous && J(C.resultOf(resB)) !== J(C.resultOf(resA))) rec.fail.push(name + ': playing the graces changed the result');
      if (ambiguous && (resB.counts.matched !== resA.counts.matched || resB.counts.missed !== resA.counts.missed)) rec.fail.push(name + ': playing the graces changed which notes were matched');
      if (resB.counts.wrong || resB.counts.extra) rec.fail.push(name + ': a played grace was counted wrong or extra: ' + J(resB.counts));
      /* a grace pressed on its own, with no note near it asked of that pitch, is a 'grace' verdict (not a stray note) */
      if (graces.length) {
        const eng = begin('on', r, hands);
        const g = eng.graces[0];
        const v = eng.noteOn({ midi: g.midi, t: g.tMs, type: 'on' });
        if (v.verdict !== 'grace' && !(v.expected)) rec.fail.push(name + ': a key pressed where a grace sounds is "' + v.verdict + '"');
      }
      /* graces off, everything else on: the same notes are asked and the same totals */
      const D = begin('jumps,repeats,ties', r, hands);
      if (D.expected.length !== A.expected.length) rec.fail.push(name + ': graces on or off, the matcher asks ' + A.expected.length + ' / ' + D.expected.length + ' notes');
      else {
        const resD = C.replay(D, C.streamEvents(D.expected, 'perfect'));
        const totals = x => J(Object.keys(x.byMeasure).sort((p, q) => p - q).map(k => [k, x.byMeasure[k].total, x.byMeasure[k].matched]));
        if (totals(resD) !== totals(resA)) rec.fail.push(name + ': graces on or off, the per-bar totals differ');
        const asked = e => J(e.expected.map(x => [x.midi, x.m, x.mIdx, e.visitOf(x), r6(x.absQ)]).map(String).sort());
        if (asked(D) !== asked(A)) rec.fail.push(name + ': graces on or off, the asked notes differ');
      }
      /* only the first time through each bar: what is missed is every later visit, and a bar is ONE bucket of byMeasureIdx */
      if (hands === 'both' && visitsOf.size) {
        const E = begin('on', r, hands);
        const seenBar = new Set(), firstVisit = new Map();
        E.expected.forEach(x => { if (!firstVisit.has(x.mIdx)) firstVisit.set(x.mIdx, E.visitOf(x)); });
        const ev2 = C.streamEvents(E.expected.filter(x => E.visitOf(x) === firstVisit.get(x.mIdx)), 'perfect');
        const res = C.replay(E, ev2);
        const later = E.expected.filter(x => E.visitOf(x) !== firstVisit.get(x.mIdx)).length;
        if (res.counts.missed !== later) rec.fail.push(name + ': playing each bar once misses ' + res.counts.missed + ' notes, the later visits are ' + later);
        if (Object.keys(res.byMeasureIdx).length !== visitsOf.size) rec.fail.push(name + ': byMeasureIdx has ' + Object.keys(res.byMeasureIdx).length + ' bars, the run plays ' + visitsOf.size);
        let total = 0;
        Object.keys(res.byMeasureIdx).forEach(k => { total += res.byMeasureIdx[k].total; });
        if (total !== E.expected.length) rec.fail.push(name + ': byMeasureIdx adds up to ' + total + ', not ' + E.expected.length);
        void seenBar;
      }
    }
    return rec;
  }

  /* ---- follow mode and Play are one piece ---- */
  function gatesUnder(score, r, hands, fix) {
    return inModeSync(fix, () => {
      const fake = { state: { score: score, hands: hands, screen: 'practice', loop: true, loopFrom: r.from, loopTo: r.to, practiceMode: 'practice' }, range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
      return proto.followGates.call(fake);
    });
  }
  const noteCount = gs => gs.reduce((n, g) => n + (g.notes || []).length, 0);
  async function gates(item) {
    const rec = { file: item.file, runs: 0, fail: [], extraRepeat: 0, extraTie: 0 };
    const score = await SW.loadScore(item);
    const first = Score.first(score), last = Score.last(score);
    const wins = C.windows(score, 2, C.cyrb64(item.file)[1]);
    await inMode('on', async () => {});
    for (const r of [{ from: first, to: last }].concat(wins)) for (const hands of ['both', 'right', 'left']) {
      const name = '[' + r.from + '..' + r.to + '] ' + hands;
      rec.runs++;
      const plan = inModeSync('on', () => PPP.practicePlan(score, r.from, r.to));
      const off = gatesUnder(score, r, hands, 'off'), on = gatesUnder(score, r, hands, 'on');
      if (!plan.graph) { rec.fail.push(name + ': not a graph plan'); continue; }
      /* every gate names its events; asking again is the same list (the cache key knows the options) */
      if (on.some(g => g.notes.some(n => !n.ev || !n.head))) rec.fail.push(name + ': a gate note has no ev/head');
      /* Play and Follow: the same notes, the same number of times, in the same order */
      const play = plan.strikes.filter(s => !s.grace && handOk(s.note, hands));
      const keyOf = (b, midi, hand) => r6(b) + '|' + midi + '|' + hand;
      const playBag = bag(play.map(s => keyOf(s.abs, s.midi, s.hand === 'l' ? 'l' : 'r')));
      const followBag = bag([].concat(...on.map(g => (g.notes || []).map(n => keyOf(g.b, n.midi, n.hand)))));
      if (playBag !== followBag) rec.fail.push(name + ': Follow asks ' + noteCount(on) + ' notes, Play strikes ' + play.length);
      /* the order: the written places of the onsets in the order the visits play them */
      const playOrder = [];
      const seen = new Set();
      const vpos = new Map(plan.visits.map((v, k) => [v, k]));
      play.slice().sort((a, b) => vpos.get(a.visit) - vpos.get(b.visit) || a.abs - b.abs).forEach(s => {
        const k = vpos.get(s.visit) + '|' + r6(s.abs);
        if (!seen.has(k)) { seen.add(k); playOrder.push(r6(s.abs)); }
      });
      const followOrder = on.filter(g => !g.rest && g.notes.length).map(g => r6(g.b));
      if (J(playOrder) !== J(followOrder)) rec.fail.push(name + ': Follow asks the onsets in another order than Play plays them');
      /* each option alone */
      const repeats = gatesUnder(score, r, hands, 'repeats'), ties = gatesUnder(score, r, hands, 'ties'), jumps = gatesUnder(score, r, hands, 'jumps');
      if (J(C.gatesOf(jumps)) !== J(C.gatesOf(off))) rec.fail.push(name + ': the jump option alone changed the gates (follow does not read it)');
      if (repeats.length < off.length) rec.fail.push(name + ': repeats on, fewer gates than the written range');
      if (J(C.gatesOf(ties).map(g => g[0])) !== J(C.gatesOf(off).map(g => g[0])) && ties.length < off.length) rec.fail.push(name + ': ties on, fewer gates');
      if (hands === 'both' && r === wins[0] + 0) void 0;
      if (hands === 'both') { rec.extraRepeat += repeats.length - off.length; rec.extraTie += noteCount(ties) - noteCount(off); }
    }
    return rec;
  }

  /* ---- the real scheduler ---- */
  async function spies(item) {
    const rec = { file: item.file, runs: 0, fail: [], strikes: 0, graces: 0 };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    for (const mode of ['audio', 'midi']) for (const hands of ['both', 'right', 'left']) {
      const c = { mode: mode, hands: hands, loop: false, range: w };
      const name = mode + ' ' + hands;
      await inMode('on', async () => {});
      PPP.practice = 'graph'; PPP.practiceFix = 'on';
      let run;
      try { run = SW.runCase(score, c); } finally { PPP.practice = 'legacy'; PPP.practiceFix = 'on'; }
      const plan = inModeSync('on', () => PPP.practicePlan(score, w.from, w.to));
      rec.runs++;
      const want = plan.strikes.filter(s => handOk(s.note, hands));
      if (run.log.notes.length !== want.length) rec.fail.push(name + ': ' + run.log.notes.length + ' notes queued, the plan strikes ' + want.length);
      if (!run.usedGraph) rec.fail.push(name + ': the scheduler did not run on a graph plan');
      if (hands === 'both') { rec.strikes += want.length; rec.graces += want.filter(s => s.grace).length; }
      /* the queue holds the plan's lap: the last release is inside it (plus the pedal's tail) */
      if (mode === 'midi' && hands === 'both' && run.log.ccs.length !== plan.ccs.length) rec.fail.push(name + ': ' + run.log.ccs.length + ' controller events queued, the plan has ' + plan.ccs.length);
      if (mode === 'audio' && hands === 'both' && run.log.clicks.length !== plan.beats.length) rec.fail.push(name + ': ' + run.log.clicks.length + ' clicks, the plan has ' + plan.beats.length);
    }
    return rec;
  }

  /* ---- the falling notes ---- */
  async function visual(item) {
    const rec = { file: item.file, fail: [], graces: 0, notes: 0 };
    const score = await SW.loadScore(item);
    const w = wholeOf(score), tempo = score.tempo || 84;
    await inMode('on', async () => {
      const tl = PPP.PianoVisual.scoreToTimeline(score, { from: w.from, to: w.to, tempo: tempo });
      const plan = tl.plan;
      if (!plan.graph) { rec.fail.push('not a graph plan'); return; }
      const shown = plan.strikes.filter(s => s.note.hand !== 'x' && isFinite(s.midi));
      rec.notes = tl.notes.length;
      if (tl.notes.length !== shown.length) rec.fail.push(tl.notes.length + ' notes drawn, the plan sounds ' + shown.length);
      const graces = tl.notes.filter(n => n.grace);
      rec.graces = graces.length;
      if (graces.length !== shown.filter(s => s.grace).length) rec.fail.push(graces.length + ' graces flagged, ' + shown.filter(s => s.grace).length + ' sound');
      /* the duration drawn is what is heard: heldQ, never the whole bar */
      const scale = tempo / Math.max(1, score.tempo || tempo);
      const byQ = new Map();
      shown.forEach(s => { const k = s.midi + '@' + r6(s.q); if (!byQ.has(k)) byQ.set(k, []); byQ.get(k).push(s); });
      let wrong = 0;
      tl.notes.forEach(n => {
        const cands = byQ.get(n.midi + '@' + r6(n.startQ));
        if (!cands) { wrong++; return; }
        const ok = cands.some(s => Math.abs(n.duration - Math.max(0.025, PPP.PianoScore.msAt(plan, s.q + Math.max(0.05, s.heldQ), scale) / 1000 - n.startTime)) <= 1e-6);
        if (!ok) wrong++;
      });
      if (wrong) rec.fail.push(wrong + ' note(s) drawn for another length than the plan holds them');
      if (graces.some(n => n.duration > 1)) rec.fail.push('a grace drawn longer than a second');
    });
    return rec;
  }

  /* the app's state for a probe: set, and put back */
  function withState(patch, fn) {
    const app = PPP.app, S = app.state, saved = {};
    Object.keys(patch).forEach(k => { saved[k] = S[k]; });
    const savedTp = app._tp, savedSim = app._sim;
    try { Object.assign(S, patch); app._tp = null; app._sim = null; return fn(app, S); } finally { app._tp = savedTp; app._sim = savedSim; Object.assign(S, saved); }
  }
  const stateFor = (score, w) => ({ score: score, tempo: score.tempo || 84, loop: false, loopFrom: w.from, loopTo: w.to, beat: 0, playing: false, hands: 'both', practiceMode: 'practice', screen: 'practice',
    toggles: Object.assign({}, PPP.app.state.toggles, { midi: false, follow: false }) });

  /* ---- the simulation (no keyboard) judges what the matcher would ---- */
  async function sim(item) {
    const rec = { file: item.file, fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    await inMode('on', async () => {
      withState(stateFor(score, w), (app, S) => {
        const plan = PPP.practicePlan(score, w.from, w.to);
        const want = plan.strikes.filter(s => !s.grace && handOk(s.note, 'both')).length;
        rec.graces = plan.strikes.filter(s => s.grace).length;
        const out = app.fire(S, 0, plan.soundLengthQ + 1);
        rec.tot = out.tot; rec.want = want;
        if (out.tot !== want) rec.fail.push('the simulation judges ' + out.tot + ' notes, the matcher would ask ' + want);
        /* a run keeps its plan: the transport holds the plan of the fixes that were on at Play, a change in the middle of the run changes nothing for it */
        app._tp = { plan: plan };
        PPP.practiceFix = 'off';
        const kept = app.fire(S, 0, plan.soundLengthQ + 1).tot;
        PPP.practiceFix = 'on';
        app._tp = null;
        rec.kept = kept;
        if (kept !== want) rec.fail.push('a run did not keep its plan: ' + kept + ' notes judged after the option was flipped, ' + want + ' before');
      });
    });
    return rec;
  }

  /* ---- a change of PPP.practiceFix is seen by the next plan, and by the gates ---- */
  async function switching(item) {
    const rec = { file: item.file, fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    await inMode('on', async () => {
      const on = PPP.practicePlan(score, w.from, w.to);
      PPP.practiceFix = 'off';
      const off = PPP.practicePlan(score, w.from, w.to);
      PPP.practiceFix = 'on';
      const on2 = PPP.practicePlan(score, w.from, w.to);
      rec.distinct = on !== off;
      rec.back = on === on2;
      rec.offIsCompat = J(C.planOf(off)) === J(C.planOf(PPP.PianoScore.of(score, w.from, w.to)));
      rec.onLonger = on.soundLengthQ > off.soundLengthQ;
      /* one gates object through the flips: its cache key has to know the options */
      const fake = { state: { score: score, hands: 'both', screen: 'practice', loop: true, loopFrom: w.from, loopTo: w.to, practiceMode: 'practice' }, range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
      const n = () => proto.followGates.call(fake).length;
      PPP.practiceFix = 'on'; const g1 = n();
      PPP.practiceFix = 'off'; const g2 = n();
      PPP.practiceFix = 'on'; const g3 = n();
      rec.gates = [g1, g2, g3];
    });
    return rec;
  }

  /* ---- a pause in a bar the plan plays twice is resumed there, and the matcher begins where the transport begins ---- */
  async function resume(item) {
    const rec = { file: item.file, fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    const app = PPP.app;
    const once = async mode => {
      PPP.practice = mode;
      PPP.practiceFix = 'on';
      await PPP.loadPracticeModule();
      return withState(stateFor(score, w), (a, S) => {
        const plan = PPP.practicePlan(score, w.from, w.to);
        /* a visit that is not the first of its bar: the way back of a D.C./D.S., or the second time through a repeat */
        const seen = new Set();
        let vIdx = -1;
        plan.visits.forEach((v, k) => { if (vIdx < 0 && seen.has(v.index) && v.lenQ > 1) vIdx = k; seen.add(v.index); });
        if (vIdx < 0) return { none: true };
        const v = plan.visits[vIdx];
        const out = { vIdx: vIdx };
        a.startTransport(S, Score.startQ(score, w.from));
        const sq = v.soundQ + 1;
        a._tp.soundQ = sq;
        a.stopTransport();
        const beat = PPP.PianoScore.writtenAtSound(plan, sq);
        S.beat = beat;
        out.sq = sq;
        out.first = PPP.PianoScore.soundAtWritten(plan, beat);
        /* the falling notes while it waits are where the pause was */
        const tl = a.visualTimeline(S);
        out.frame = a.visualTransportFrame(tl).soundQ;
        a.startTransport(S, beat);
        out.b0 = a._tp.b0;
        /* the matcher begins with it: the first note of that visit at or after the beat is expected about now */
        a.liveMidi = () => true;
        try {
          a.beginRun(S, beat, 1000);
          const exp = a._perf.expected.filter(x => a._perf.visitOf(x) === vIdx && x.absQ >= beat - 1e-6).sort((p, q) => p.absQ - q.absQ);
          out.near = exp.length ? exp[0].tMs - 1000 : null;
          out.perQ = 60000 / (S.tempo || 84);
          out.dq = exp.length ? exp[0].absQ - beat : null;
        } finally { delete a.liveMidi; }
        a._tp = null;
        return out;
      });
    };
    try {
      rec.graph = await once('graph');
      rec.legacy = await once('legacy');
    } finally { PPP.practice = 'legacy'; PPP.practiceFix = 'on'; app._resume = null; }
    const g = rec.graph;
    if (g.none) { rec.fail.push('no bar is played twice in this piece'); return rec; }
    if (Math.abs(g.b0 - g.sq) > 1e-6) rec.fail.push('the transport resumes at sounding quarter ' + g.b0 + ', not where the pause was (' + g.sq + ', the first visit of the bar is at ' + g.first + ')');
    if (Math.abs(g.frame - g.sq) > 1e-6) rec.fail.push('the falling notes wait at ' + g.frame + ', not where the pause was (' + g.sq + ')');
    if (g.near === null || g.near < -1 || g.near > g.dq * g.perQ + 5) rec.fail.push('the matcher expects the note of the resumed visit ' + g.near + ' ms from the start (' + (g.dq * g.perQ) + ' wanted)');
    if (Math.abs(g.first - g.sq) < 1e-6) rec.fail.push('the first visit of the bar is the visit that was paused: the probe proves nothing');
    const l = rec.legacy;
    if (!l.none && Math.abs(l.b0 - l.first) > 1e-6) rec.fail.push('legacy: the transport does not resume at the first visit, as it always has (' + l.b0 + ' against ' + l.first + ')');
    return rec;
  }

  /* ---- the keyboard hint agrees with what the clock strikes (a tie that leads nowhere) ---- */
  async function hint(item) {
    const rec = { file: item.file, fail: [], dangling: 0 };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    const legacy = PPP.PianoScore.of(score, w.from, w.to);
    const dangling = score.notes.filter(n => !n.rest && n.hand !== 'x' && n.midi != null && n.tieStop && !legacy.cont.has(n));
    rec.dangling = dangling.length;
    if (!dangling.length) { rec.fail.push('no tie that leads nowhere in this piece'); return rec; }
    const n = dangling[0];
    for (const fix of ['on', 'off', 'jumps,graces,repeats']) {
      await inMode(fix, async () => {
        const patch = stateFor(score, w);
        patch.beat = n.abs + 0.01;
        rec[fix] = withState(patch, app => app.expected().indexOf(n.midi) >= 0);
      });
    }
    if (!rec.on) rec.fail.push('the fixes on: the hint does not show a note the clock strikes');
    if (rec.off) rec.fail.push('the fixes off: the hint shows a tied-to note (today it does not)');
    if (rec['jumps,graces,repeats']) rec.fail.push('the tie option off: the hint shows a tied-to note');
    return rec;
  }

  /* ---- the transport itself: the playhead walks the plan's visits, a lap is the plan's length, a loop starts over at its first bar ---- */
  /* app.advance(now) stepped on a clock of this probe's own (no piano, no keyboard: the simulation judges), setState applied at once. Returns the bars the playhead stood in, in order, each
     once per stay, and the written beats; `laps` is how many times completeLap ran. */
  function walkTransport(app, S, score, plan, o) {
    const out = { bars: [], laps: 0, ended: false };
    const savedSet = app.setState, savedCl = app.completeLap;
    app.setState = function (p) { if (typeof p === 'function') p = p(S); Object.assign(S, p); };
    app.completeLap = function () { out.laps++; return savedCl.apply(this, arguments); };
    try {
      S.playing = true;
      S.beat = Score.startQ(score, o.from);
      app.startTransport(S, S.beat);
      const tp = app._tp;
      tp.waiting = false;
      tp.t0 = 1000;
      const lap = PPP.PianoScore.msAt(plan, plan.soundLengthQ, tp.scale);
      const stop = 1000 + lap * (o.laps || 1) + 80;
      let last = null;
      for (let now = 1000; now <= stop; now += 20) {
        app.advance(now);
        if (!S.playing) { out.ended = true; break; }                 /* the beat is put back to the start when a lap ends: not a stay */
        const m = Score.at(score, S.beat);
        if (m !== last) { out.bars.push(m); last = m; }
      }
      out.beat = S.beat;
    } finally { app.setState = savedSet; app.completeLap = savedCl; app._tp = null; S.playing = false; }
    return out;
  }
  async function run(item, o) {
    o = o || {};
    const rec = { file: item.file, fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    const barsOf = plan => { const b = []; plan.visits.forEach(v => { if (b[b.length - 1] !== v.number) b.push(v.number); }); return b; };
    await inMode('on', async () => {
      /* Start to finish: one lap, and it ends where the plan ends */
      withState(Object.assign(stateFor(score, w), { tempo: score.tempo || 84 }), (app, S) => {
        const plan = PPP.practicePlan(score, w.from, w.to);
        const r = walkTransport(app, S, score, plan, { from: w.from, laps: 1 });
        rec.whole = { want: barsOf(plan), got: r.bars, laps: r.laps, ended: r.ended };
        if (J(r.bars) !== J(rec.whole.want)) rec.fail.push('the playhead walked the bars ' + r.bars.slice(0, 40).join(' ') + ' ..., the plan has ' + rec.whole.want.slice(0, 40).join(' ') + ' ...');
        if (r.laps !== 1 || !r.ended) rec.fail.push('Start to finish: ' + r.laps + ' lap(s) completed, ended ' + r.ended);
      });
      /* a loop over a window that holds the sign: two laps, the second begins at the loop's first bar */
      const plan0 = PPP.practicePlan(score, w.from, w.to);
      const j = (plan0.jumps || [])[0];
      if (j) {
        const sign = plan0.visits[j.from].index, target = j.to, ms = score.measures;
        const win = { from: ms[Math.min(sign, target)].number, to: ms[Math.max(sign, target)].number };
        withState(Object.assign(stateFor(score, win), { tempo: score.tempo || 84, loop: true, loopFrom: win.from, loopTo: win.to }), (app, S) => {
          const plan = PPP.practicePlan(score, win.from, win.to);
          const r = walkTransport(app, S, score, plan, { from: win.from, laps: 2 });
          const one = barsOf(plan);
          rec.loop = { win: win, want: one, got: r.bars, laps: r.laps };
          if (r.laps < 1) rec.fail.push('the loop completed no lap');
          if (J(r.bars.slice(0, one.length)) !== J(one)) rec.fail.push('the loop walked ' + r.bars.slice(0, 40).join(' ') + ' ..., the plan has ' + one.slice(0, 40).join(' ') + ' ...');
          if (r.bars[one.length] !== one[0]) rec.fail.push('the second lap of the loop does not begin at the loop start (bar ' + r.bars[one.length] + ', not ' + one[0] + ')');
        });
      }
    });
    return rec;
  }

  /* ---- the tie at a jump, on the hand-written piece ---- */
  async function fixture(item) {
    const out = { fail: [] };
    const score = await SW.loadScore(item);
    const w = wholeOf(score);
    const barOf = n => Score.measure(score, n).index;
    const numbers = plan => plan.visits.map(v => v.number + (v.leg ? "'" : '')).join(' ');
    const d5 = (plan, m) => plan.strikes.filter(s => s.note.m === m && s.midi === 74 && !s.grace);
    out.legacy = (() => {
      const p = PPP.PianoScore.of(score, w.from, w.to);
      return { order: p.visits.map(v => v.number).join(' '), bar6: p.strikes.filter(s => s.m === 6 && s.midi === 74).length, bar7: p.strikes.filter(s => s.m === 7 && s.midi === 74).length };
    })();
    await inMode('on', async () => {
      const p = PPP.practicePlan(score, w.from, w.to);
      out.graph = !!p.graph;
      out.order = numbers(p);
      out.bar6 = d5(p, 6).map(s => [s.visit.leg, r6(s.upQ - s.q), r6(s.heldQ)]);
      out.bar7 = d5(p, 7).map(s => [s.visit.leg, s.visit.jumped, r6(s.upQ - s.q), r6(s.heldQ)]);
      /* the matcher asks the coda's D5, once, and a perfect performance matches it */
      const eng = new PPP.PerformanceEngine(score);
      eng.begin({ from: w.from, to: w.to, hands: 'both', tempo: score.tempo || 84, startedAt: 0 });
      out.askedBar7 = eng.expected.filter(x => x.m === 7 && x.midi === 74).length;
      out.askedBar6 = eng.expected.filter(x => x.m === 6 && x.midi === 74).length;
      const res = C.replay(eng, C.streamEvents(eng.expected, 'perfect'));
      out.perfect = [res.counts.expected, res.counts.matched, res.counts.wrong, res.counts.extra];
      /* the gates ask it once, on the way back */
      const gs = gatesUnder(score, w, 'both', 'on');
      out.gateBar7 = gs.filter(g => g.m === 7 && g.notes.some(n => n.midi === 74)).length;
      out.gateBar7NoTies = gatesUnder(score, w, 'both', 'jumps,graces,repeats').filter(g => g.m === 7 && g.notes.some(n => n.midi === 74)).length;
      /* drawn: bar 6's D5 for one quarter, not two */
      const tl = PPP.PianoVisual.scoreToTimeline(score, { from: w.from, to: w.to, tempo: score.tempo || 84 });
      const sec = PPP.PianoScore.msAt(p, 1, 1) / 1000;
      out.drawn = tl.notes.filter(n => n.midi === 74 && n.measureIndex === barOf(6)).map(n => r6(n.duration / sec));
    });
    /* with the fixes off, the old player's answer: held for the chain, the coda's D5 carried into (silent) */
    await inMode('off', async () => {
      const p = PPP.practicePlan(score, w.from, w.to);
      out.off = { order: numbers(p), bar6: d5(p, 6).map(s => r6(s.upQ - s.q)), bar7: d5(p, 7).length };
    });
    /* only the jumps: the clock strikes the coda's D5 and follow does not (the tie option is off) */
    await inMode('jumps,repeats', async () => {
      const p = PPP.practicePlan(score, w.from, w.to);
      out.jumpsOnly = { bar7: d5(p, 7).length, gate: gatesUnder(score, w, 'both', 'jumps,repeats').filter(g => g.m === 7 && g.notes.some(n => n.midi === 74)).length };
    });
    return out;
  }

  /* ---- a piece the plan cannot be made for ---- */
  async function fallbacks(item) {
    const out = [];
    const check = (name, ok, detail) => out.push({ name: name, ok: !!ok, detail: ok ? '' : String(detail || '') });
    const app = window.PPPEngrave.app, origResolve = app.resolveSync;
    const stats = () => PPP.practiceStats.practiceFallback;
    try {
      PPP.practice = 'graph'; PPP.practiceFix = 'on';
      await PPP.loadPracticeModule();
      const modes = {
        BUILD_ERROR: (sc, real) => ({ graph: Object.assign({}, real.graph, { parts: null }), via: 'live', link: real.link }),
        LINK_FAILED: (sc, real) => ({ graph: real.graph, via: 'live', link: { ok: false, mismatch: 'planted', byNote: [] } }),
        IDENTITY: (sc, real) => ({ graph: real.graph, via: 'live', link: { ok: true, byNote: [] } })
      };
      for (const reason of Object.keys(modes)) {
        const sc = await SW.loadScore(item);
        const real = origResolve.call(app, sc);
        app.resolveSync = function (s) { return s === sc ? modes[reason](sc, real) : origResolve.call(this, s); };
        try {
          const f0 = stats().total, g0 = PPP.practiceStats.graph;
          let plan = null, threw = null;
          try { plan = PPP.practicePlan(sc, Score.first(sc), Score.last(sc)); } catch (e) { threw = e; }
          check(reason + ' with the fixes on: nothing is thrown', !threw, msg(threw));
          check(reason + ' with the fixes on: the plan is the legacy plan, counted once with its reason', plan && !plan.graph && plan === PPP.PianoScore.of(sc, Score.first(sc), Score.last(sc)) &&
            stats().total === f0 + 1 && PPP.practiceStats.graph === g0 && (stats().reasons[reason] || 0) >= 1, JSON.stringify(stats().reasons));
          /* follow mode and the matcher play the legacy plan: no graces, today's gates */
          const eng = new PPP.PerformanceEngine(sc);
          eng.begin({ from: Score.first(sc), to: Score.last(sc), hands: 'both', tempo: sc.tempo || 84, startedAt: 0 });
          check(reason + ' with the fixes on: the matcher asks the legacy notes', eng.expected.length > 0 && eng._plan === plan && eng.expected.every(x => x.evId === undefined), eng.expected.length);
          const gs = gatesUnder(sc, { from: Score.first(sc), to: Score.last(sc) }, 'both', 'on');
          check(reason + ' with the fixes on: follow mode gates the legacy range once', gs.length > 0 && gs.every(g => g.notes.every(n => n.ev === undefined)), gs.length);
        } finally { app.resolveSync = origResolve; }
      }
    } catch (e) {
      check('the fallback probe ran', false, msg(e));
    } finally {
      app.resolveSync = origResolve;
      PPP.practice = 'legacy'; PPP.practiceFix = 'on';
    }
    return out;
  }

  /* ---- how long the plan takes ---- */
  async function perf(item, o) {
    o = o || {};
    const rounds = o.rounds || 7, per = o.per || 15;
    const score = await SW.loadScore(item);
    const a = Score.first(score), b = Score.last(score);
    const med = xs => xs.slice().sort((x, y) => x - y)[(xs.length - 1) >> 1];
    const time = fn => {
      for (let i = 0; i < 4; i++) fn();
      const rs = [];
      for (let r = 0; r < rounds; r++) { const t0 = performance.now(); for (let i = 0; i < per; i++) fn(); rs.push((performance.now() - t0) / per); }
      return med(rs);
    };
    const src = window.PPPEngrave.app.resolveSync(score);
    await inMode('on', async () => {});
    const legacy = time(() => PPP.PianoScore.build(score, a, b));
    const res = { file: item.file, notes: score.notes.filter(n => !n.rest).length, legacy: legacy };
    PPP.practice = 'graph';
    try {
      for (const [name, fix] of [['on', 'on'], ['off', 'off']]) {
        PPP.practiceFix = fix;
        res[name] = time(() => PPP.practiceGraphBuild(score, a, b, src));
      }
      PPP.practiceFix = 'on';
      const first = PPP.practicePlan(score, a, b);
      res.cached = PPP.practicePlan(score, a, b) === first;
      res.cachedTime = time(() => PPP.practicePlan(score, a, b));
      res.jumps = (first.jumps || []).length;
      res.graces = first.strikes.filter(s => s.grace).length;
    } finally { PPP.practice = 'legacy'; PPP.practiceFix = 'on'; }
    return res;
  }

  /* ---- the corpus with the fixes on ---- */
  async function sweep(items) {
    const out = [];
    await inMode('on', async () => {});
    for (const item of items) {
      const rec = { file: item.file, fail: [] };
      try {
        const score = await SW.loadScore(item);
        const w = wholeOf(score);
        const src = window.PPPEngrave.app.resolveSync(score);
        rec.via = src && src.via; rec.linkOk = !!(src && src.link && src.link.ok);
        const legacy = PPP.PianoScore.of(score, w.from, w.to);
        await inMode('on', async () => {
          const f0 = PPP.practiceStats.practiceFallback.total;
          const p = PPP.practicePlan(score, w.from, w.to);
          rec.graph = !!p.graph;
          rec.fallback = PPP.practiceStats.practiceFallback.total - f0;
          if (!p.graph) return;
          rec.jumps = (p.jumps || []).length;
          rec.jumpVisits = p.visits.length - legacy.visits.length;
          rec.lenDelta = p.soundLengthQ - legacy.soundLengthQ;
          const gs = p.strikes.filter(s => s.grace);
          rec.graceStrikes = gs.length;
          rec.graceEvents = new Set(gs.map(s => s.ev)).size;
          /* every strike that is not a grace is a Score note, and the legacy plan's strikes are all still there when no jump moved the order */
          const set = new Set(score.notes);
          if (!p.strikes.every(s => (s.grace ? !!s.note : set.has(s.note)))) rec.fail.push('a strike names a note that is neither the Score\'s nor a grace');
          if (!rec.jumps && !rec.graceStrikes && p.strikes.length !== legacy.strikes.length) rec.fail.push('no jump, no grace, and ' + p.strikes.length + ' strikes against the legacy ' + legacy.strikes.length);
          if (!rec.jumps && J(C.planOf(Object.assign({}, p, { strikes: p.strikes.filter(s => !s.grace) }))).length === 0) rec.fail.push('empty');
          /* Play and Follow: one piece */
          const play = p.strikes.filter(s => !s.grace && handOk(s.note, 'both'));
          const keyOf = (b, midi, hand) => r6(b) + '|' + midi + '|' + hand;
          const gatesOn = gatesUnder(score, w, 'both', 'on');
          if (bag(play.map(s => keyOf(s.abs, s.midi, s.hand === 'l' ? 'l' : 'r'))) !== bag([].concat(...gatesOn.map(g => g.notes.map(n => keyOf(g.b, n.midi, n.hand)))))) rec.fail.push('Follow does not ask what Play strikes');
          /* the matcher asks every note that is not a grace */
          const eng = new PPP.PerformanceEngine(score);
          eng.begin({ from: w.from, to: w.to, hands: 'both', tempo: score.tempo || 84, startedAt: 0 });
          if (eng.expected.length !== play.length) rec.fail.push('the matcher asks ' + eng.expected.length + ' notes, Play strikes ' + play.length);
          /* each option alone, against the compat plan */
          const off = gatesUnder(score, w, 'both', 'off');
          rec.repeatGates = gatesUnder(score, w, 'both', 'repeats').length - off.length;
          rec.tieNotes = noteCount(gatesUnder(score, w, 'both', 'ties')) - noteCount(off);
        });
      } catch (e) {
        rec.error = msg(e);
      }
      out.push(rec);
    }
    return out;
  }

  window.PPPOptionsProbe = { choice, plan, lap, matcher, gates, spies, visual, fixture, fallbacks, perf, sweep, sim, switching, hint, resume, run };
})();
