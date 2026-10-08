/* G11a-3: the probes of tests/practice/switch.js that run INSIDE the app's page (added with addScriptTag after canon.js). A plain script: it sets window.PPPSwitchProbe.

   Every probe takes plain data and returns plain data, so the driver can print it. They switch PPP.practice themselves (setMode) and leave it on 'legacy'. A probe that needs the
   page's own parts reads them through window.PPP: the real PerformanceEngine, startTransport/schedule on a fake piano and a fake MIDI output (the spies of parity.js), the
   falling-note timeline, the follow gates, and the plan functions.

     spies(items, {graph})        the real scheduler at 8x the written tempo, legacy and (graph) the graph plan: every note on/off, CC and click, digest of the legacy log
     matcher(items, {windows})    five scripted performances through the real PerformanceEngine on each plan: equal results; ids on `expected`; byMeasureIdx
     visual(items)                the falling-note timeline (scoreToTimeline) of each plan: equal
     gates(items)                 follow mode's gates (the app's followGates) under each switch: equal; ids under 'graph'
     leak(item)                   no place that asks for a plan is left on the legacy one (PianoScore.of is not called under 'graph')
     fallbacks()                  a song whose graph does not state its music: the legacy plan, counted, by reason and by song, never a throw
     sweep(items, {projected})    every file of the corpus under 'graph': is the plan a graph plan, and is it the legacy plan to the bit (strikes, notes, holds, ties)
     perf(item, {rounds})         plan build time, legacy against graph */
(function () {
  'use strict';
  const C = window.PPPPracticeCanon, PPP = window.PPP, Score = PPP.Score;
  const J = JSON.stringify;
  const round = x => Math.round(x * 1e4) / 1e4;
  /* PPP.practice is not there on a tree from before G11a-3 (the recorder of the baseline runs on one) */
  const setMode = m => { if ('practice' in PPP) PPP.practice = m; };
  const message = e => String(e && (e.message || e) || e).slice(0, 160);

  async function loadScore(item) {
    let xml = item.text;
    if (xml == null) {
      const res = await fetch('/' + item.file);
      xml = /\.mxl$/.test(item.file) ? await PPP.readMxl(await res.arrayBuffer()) : await res.text();
    }
    return PPP.scoreFromXml(xml, item.file.split('/').pop());
  }

  /* ---- the real scheduler on spies (parity.js spiesInPage, one plan at a time: the switch decides which) ---- */
  function runCase(score, c) {
    const app = PPP.app, S = app.state, PS = PPP.PianoScore;
    const saved = {};
    ['score', 'tempo', 'loop', 'loopFrom', 'loopTo', 'beat', 'playing', 'hands', 'practiceMode', 'screen', 'metro', 'toggles'].forEach(k => { saved[k] = S[k]; });
    const savedPiano = app._piano, savedTp = app._tp;
    const log = { notes: [], ccs: [], clicks: [] };
    const T0 = 1000;
    const fakePiano = {
      running: () => true, wake: () => {}, now: () => 0, clockOffset: () => 0,
      strike: (midi, when, vel) => { const v = { midi: midi, vel: vel, t: round(when * 1000 - T0), up: null }; log.notes.push(v); return v; },
      release: (v, when) => { if (v) v.up = round(when * 1000 - T0); },
      click: (when, accent) => { log.clicks.push([round(when * 1000 - T0), accent ? 1 : 0]); }, cancelAfter: () => {}, silence: () => {}
    };
    const fakeOut = {
      noteOn: (midi, vel, t) => { log.notes.push({ midi: midi, vel: vel, t: round(t - T0), up: null, open: true }); return true; },
      noteOff: (midi, t) => {
        for (let i = log.notes.length - 1; i >= 0; i--) if (log.notes[i].open && log.notes[i].midi === midi && log.notes[i].up === null) { log.notes[i].up = round(t - T0); break; }
      },
      cc: (cc, value, t) => { log.ccs.push([round(t - T0), cc, value]); }, panic: () => {}, localOn: () => {}
    };
    let usedGraph = false;
    try {
      const scale8 = (score.tempo || 84) * 8;
      Object.assign(S, { score: score, tempo: scale8, loop: !!c.loop, loopFrom: c.range.from, loopTo: c.range.to, beat: 0, playing: false, hands: c.hands,
        practiceMode: 'practice', screen: 'practice', metro: true, toggles: Object.assign({}, S.toggles, { notes: true, follow: false, midiOut: false, midi: false, sound: true }) });
      app._piano = fakePiano;
      app._tp = null;
      if (c.mode === 'midi') { app.midiOutLive = () => true; app.midiOutLayer = () => fakeOut; }
      app.startTransport(S, Score.startQ(score, c.range.from));
      const tp = app._tp;
      tp.t0 = T0; tp.schedT = T0;
      const plan = tp.plan;
      usedGraph = !!(plan && plan.graph);
      const ahead = Math.max(PPP.PIANO.lookaheadMs, c.mode === 'midi' ? 1600 : 0);
      const lap = PS.msAt(plan, plan.soundLengthQ, tp.scale);
      const end = T0 + lap * (c.loop ? 2.2 : 1) + 2 * ahead;
      for (let now = T0 - 50; now < end; now += ahead / 2) app.schedule(now, S);
    } finally {
      delete app.midiOutLive; delete app.midiOutLayer;
      app._piano = savedPiano; app._tp = savedTp;
      Object.assign(S, saved);
    }
    log.notes.forEach(n => { delete n.open; });
    return { log: log, usedGraph: usedGraph };
  }

  async function spies(items, o) {
    o = o || {};
    const out = [];
    for (const item of items) {
      const rec = { file: item.file, runs: 0, events: 0, graphRuns: 0, fail: [], digest: null };
      try {
        const score = await loadScore(item);
        const whole = { from: Score.first(score), to: Score.last(score) };
        const wins = C.windows(score, 20, C.cyrb64(item.file)[1]);
        const cases = [];
        ['audio', 'midi'].forEach(mode => ['both', 'right', 'left'].forEach(h => cases.push({ mode: mode, hands: h, loop: false, range: whole })));
        if (wins[0]) cases.push({ mode: 'midi', hands: 'both', loop: true, range: wins[0] });
        if (wins[1]) cases.push({ mode: 'audio', hands: 'right', loop: true, range: wins[1] });
        const digests = [];
        for (const c of cases) {
          const name = c.mode + ' ' + c.hands + (c.loop ? ' loop' : '') + ' [' + c.range.from + '..' + c.range.to + ']';
          setMode('legacy');
          const a = runCase(score, c);
          digests.push(C.digest(J(a.log)));
          rec.runs++;
          rec.events += a.log.notes.length + a.log.ccs.length + a.log.clicks.length;
          if (c.hands === 'both' && (!a.log.notes.length || !a.log.clicks.length)) rec.fail.push(name + ': the spy heard nothing');
          if (!o.graph) continue;
          const before = PPP.practiceStats.practiceFallback.total;
          setMode('graph');
          let b;
          try { b = runCase(score, c); } finally { setMode('legacy'); }
          if (J(a.log) !== J(b.log)) rec.fail.push(name + ': the queued ' + (J(a.log.notes) !== J(b.log.notes) ? 'notes' : J(a.log.ccs) !== J(b.log.ccs) ? 'controller events' : 'clicks') + ' differ under graph');
          if (!b.usedGraph) rec.fail.push(name + ': the scheduler did not run on a graph plan'); else rec.graphRuns++;
          if (PPP.practiceStats.practiceFallback.total !== before) rec.fail.push(name + ': a fallback was counted');
        }
        rec.digest = C.digest(digests.join(','));
      } catch (e) {
        rec.fail.push('error: ' + message(e));
      } finally { setMode('legacy'); }
      out.push(rec);
    }
    return out;
  }

  /* ---- the matcher: five scripted performances on each plan ---- */
  const STREAMS = ['perfect', 'late80', 'wrong7', 'miss10', 'roll60'];
  async function matcher(items, o) {
    o = o || {};
    const out = [];
    for (const item of items) {
      const rec = { file: item.file, runs: 0, graphRuns: 0, fail: [] };
      try {
        const score = await loadScore(item);
        const first = Score.first(score), last = Score.last(score), base = score.tempo || 84;
        const wins = C.windows(score, o.windows || 2, C.cyrb64(item.file)[1]);
        const jobs = [];
        ['both', 'right', 'left'].forEach(h => STREAMS.forEach(s => jobs.push([{ from: first, to: last }, h, 1, s])));
        STREAMS.forEach(s => jobs.push([{ from: first, to: last }, 'both', 0.5, s]));
        wins.forEach(w => STREAMS.forEach(s => jobs.push([w, 'both', 1, s])));
        const one = (mode, r, h, sc, stream) => {
          setMode(mode);
          try {
            const eng = new PPP.PerformanceEngine(score);
            eng.begin({ from: r.from, to: r.to, hands: h, tempo: base * sc, startedAt: 0 });
            const exp = eng.expected.slice();
            const res = C.replay(eng, C.streamEvents(exp, stream));
            return { outcome: J(C.outcomeOf(eng, res)), res: res, exp: exp, plan: eng._plan };
          } finally { setMode('legacy'); }
        };
        for (const [r, h, sc, stream] of jobs) {
          const name = '[' + r.from + '..' + r.to + '] ' + h + ' x' + sc + ' ' + stream;
          const a = one('legacy', r, h, sc, stream), b = one('graph', r, h, sc, stream);
          rec.runs++;
          if (a.outcome !== b.outcome) rec.fail.push(name + ': the verdicts differ under graph');
          if (!(b.plan && b.plan.graph)) rec.fail.push(name + ': the matcher did not run on a graph plan'); else rec.graphRuns++;
          if (b.exp.some(x => !x.ev || !x.head || x.mIdx == null)) rec.fail.push(name + ': an expected note under graph has no ev/head/mIdx');
          if (a.exp.some(x => x.mIdx == null)) rec.fail.push(name + ': an expected note under legacy has no mIdx');
          if (J(a.exp.map(x => x.mIdx)) !== J(b.exp.map(x => x.mIdx))) rec.fail.push(name + ': mIdx differs');
          if (J(Object.keys(a.res.byMeasure)) !== J(Object.keys(b.res.byMeasure))) rec.fail.push(name + ': byMeasure keys differ');
          if (!a.res.byMeasureIdx || !b.res.byMeasureIdx) { rec.fail.push(name + ': the result has no byMeasureIdx'); continue; }
          if (J(a.res.byMeasureIdx) !== J(b.res.byMeasureIdx)) rec.fail.push(name + ': byMeasureIdx differs');
          /* byMeasureIdx is byMeasure by index: the same buckets, the same totals */
          [a, b].forEach(x => {
            const sum = m => Object.keys(m).reduce((t, k) => t + m[k].total + m[k].wrong + m[k].extra, 0);
            if (sum(x.res.byMeasure) !== sum(x.res.byMeasureIdx)) rec.fail.push(name + ': byMeasureIdx does not add up to byMeasure');
            if (Object.keys(x.res.byMeasureIdx).some(k => +k < 0 || +k >= score.measures.length)) rec.fail.push(name + ': byMeasureIdx has an index outside the score');
          });
          /* Learning.record reads byMeasure alone: the history it folds has the same three fields and numbers as keys */
          const meta = { tempo: base * sc, scoreTempo: base, hands: h, mode: 'practice', range: [r.from, r.to] };
          const ha = PPP.Learning.record(PPP.Learning.empty(), a.res, meta), hb = PPP.Learning.record(PPP.Learning.empty(), b.res, meta);
          if (J(ha) !== J(hb) || J(Object.keys(hb).sort()) !== J(['byMeasure', 'rev', 'runs'])) rec.fail.push(name + ': Learning.record gives another history under graph');
        }
      } catch (e) {
        rec.fail.push('error: ' + message(e));
      } finally { setMode('legacy'); }
      out.push(rec);
    }
    return out;
  }

  /* ---- the falling notes ---- */
  async function visual(items) {
    const out = [];
    for (const item of items) {
      const rec = { file: item.file, runs: 0, graphRuns: 0, fail: [] };
      try {
        const score = await loadScore(item);
        const first = Score.first(score), last = Score.last(score), base = score.tempo || 84;
        const wins = C.windows(score, 2, C.cyrb64(item.file)[1]);
        const ranges = [{ from: first, to: last }].concat(wins);
        for (const r of ranges) for (const tempo of [base, base * 0.5]) {
          const view = tl => J([tl.notes, tl.measures, tl.duration, tl.maxDuration, tl.range, tl.scale, tl.tempo]);
          setMode('legacy');
          const a = PPP.PianoVisual.scoreToTimeline(score, { from: r.from, to: r.to, tempo: tempo });
          setMode('graph');
          let b;
          try { b = PPP.PianoVisual.scoreToTimeline(score, { from: r.from, to: r.to, tempo: tempo }); } finally { setMode('legacy'); }
          rec.runs++;
          const name = '[' + r.from + '..' + r.to + '] tempo ' + tempo;
          if (!(b.plan && b.plan.graph)) rec.fail.push(name + ': the timeline was not made from a graph plan'); else rec.graphRuns++;
          if (view(a) !== view(b)) {
            const i = a.notes.findIndex((n, k) => J(n) !== J(b.notes[k]));
            rec.fail.push(name + ': the falling notes differ under graph' + (i >= 0 ? ' (note ' + i + ': ' + J(a.notes[i]).slice(0, 110) + ' vs ' + J(b.notes[i]).slice(0, 110) + ')' : ''));
          }
        }
      } catch (e) {
        rec.fail.push('error: ' + message(e));
      } finally { setMode('legacy'); }
      out.push(rec);
    }
    return out;
  }

  /* ---- follow mode's gates ---- */
  async function gates(items) {
    const proto = Object.getPrototypeOf(PPP.app);
    const out = [];
    for (const item of items) {
      const rec = { file: item.file, runs: 0, graphRuns: 0, fail: [] };
      try {
        const score = await loadScore(item);
        const first = Score.first(score), last = Score.last(score);
        const wins = C.windows(score, 3, C.cyrb64(item.file)[1]);
        const gatesOf = (mode, from, to, hands) => {
          setMode(mode);
          try {
            const fake = { state: { score: score, hands: hands, screen: 'practice', loop: true, loopFrom: from, loopTo: to, practiceMode: 'practice' },
              range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
            return proto.followGates.call(fake);
          } finally { setMode('legacy'); }
        };
        for (const r of [{ from: first, to: last }].concat(wins)) for (const h of ['both', 'right', 'left']) {
          const a = gatesOf('legacy', r.from, r.to, h), b = gatesOf('graph', r.from, r.to, h);
          rec.runs++;
          const name = '[' + r.from + '..' + r.to + '] ' + h;
          if (J(C.gatesOf(a)) !== J(C.gatesOf(b))) rec.fail.push(name + ': the gates differ under graph');
          if (b.every(g => !g.notes.length)) rec.graphRuns += 0;
          else if (b.some(g => g.notes.some(n => !n.ev || !n.head))) rec.fail.push(name + ': a gate note has no ev/head under graph');
          else rec.graphRuns++;
          if (a.some(g => g.notes.some(n => n.ev !== undefined))) rec.fail.push(name + ': a legacy gate note carries an ev');
        }
      } catch (e) {
        rec.fail.push('error: ' + message(e));
      } finally { setMode('legacy'); }
      out.push(rec);
    }
    return out;
  }

  /* ---- no call site is left on the legacy plan ---- */
  /* Under 'graph' every place that asks for a plan gets the graph plan: PianoScore.of is not called at all (a call site that still asked it would play the legacy plan - the same notes, which is
     why only a count can tell). The places: the matcher's begin, beginRun, startTransport, advance (a new plan when hands or range change under a running transport), fire, the falling notes,
     follow mode's gates. */
  async function leak(item) {
    const out = [];
    const check = (name, ok, detail) => out.push({ name: name, ok: !!ok, detail: ok ? '' : String(detail || '') });
    const app = PPP.app, S = app.state, PS = PPP.PianoScore;
    const score = await loadScore(item);
    const first = Score.first(score), last = Score.last(score);
    const saved = {};
    ['score', 'tempo', 'loop', 'loopFrom', 'loopTo', 'beat', 'playing', 'hands', 'practiceMode', 'screen', 'metro', 'toggles', 'runHit', 'runTot'].forEach(k => { saved[k] = S[k]; });
    const savedPiano = app._piano, savedTp = app._tp, savedPerf = app._perf, savedSim = app._sim, savedSetState = app.setState, hadOwnSetState = Object.prototype.hasOwnProperty.call(app, 'setState');
    const origOf = PS.of;
    let calls = 0;
    PS.of = function () { calls++; return origOf.apply(this, arguments); };
    const fakePiano = { running: () => true, wake: () => {}, now: () => 0, clockOffset: () => 0, strike: () => ({}), release: () => {}, click: () => {}, cancelAfter: () => {}, silence: () => {} };
    try {
      setMode('graph');
      Object.assign(S, { score: score, tempo: (score.tempo || 84) * 8, loop: true, loopFrom: first, loopTo: Math.min(last, first + 5), beat: 0, playing: false, hands: 'both', practiceMode: 'practice',
        screen: 'practice', metro: true, toggles: Object.assign({}, S.toggles, { notes: true, follow: false, midiOut: false, midi: false, sound: true }), runHit: 0, runTot: 0 });
      app._piano = fakePiano; app._tp = null; app._sim = null;
      app.setState = function () {};            /* the page is not repainted by what this probe pushes through the transport */
      const c0 = calls;
      app.beginRun(S, null, null);
      check('beginRun: the matcher expects on a graph plan (ev on its notes)', app._perf && app._perf.expected.length > 0 && app._perf.expected.every(x => x.ev) && app._perf._plan && app._perf._plan.graph, 'plan ' + !!(app._perf && app._perf._plan));
      app.startTransport(S, Score.startQ(score, S.loopFrom));
      const tp = app._tp;
      check('startTransport: the transport holds a graph plan', tp && tp.plan && tp.plan.graph);
      tp.t0 = 1000; tp.schedT = 1000;
      app.schedule(1000, S);
      /* a change under a running transport (here the hands) plans again from where it is */
      S.hands = 'right';
      const oldPlan = tp.plan;
      app.advance(1050);
      check('advance: a change of hands under a running transport is planned again, from the graph', app._tp && app._tp.plan && app._tp.plan.graph && app._tp.key.indexOf('right') > 0, app._tp && app._tp.key);
      void oldPlan;
      const f = app.fire(S, 0, 8);
      check('fire: the simulation reads the graph plan', f && f.tot > 0, JSON.stringify(f));
      const tl = PPP.PianoVisual.scoreToTimeline(score, { from: first, to: last, tempo: score.tempo || 84 });
      check('the falling notes: a graph plan', tl.plan && tl.plan.graph);
      const eng = new PPP.PerformanceEngine(score);
      eng.begin({ from: first, to: last, hands: 'both', tempo: score.tempo || 84, startedAt: 0 });
      check('the matcher: a graph plan', eng._plan && eng._plan.graph);
      const proto = Object.getPrototypeOf(app);
      const fake = { state: { score: score, hands: 'both', screen: 'practice', loop: true, loopFrom: first, loopTo: last, practiceMode: 'practice' }, range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
      const g = proto.followGates.call(fake);
      check("follow mode: the gates name the graph's events", g.some(x => x.notes.length) && g.every(x => x.notes.every(n => n.ev && n.head)));
      check("PianoScore.of is not called at all under 'graph' (" + (calls - c0) + " calls)", calls === c0, calls - c0);
    } catch (e) {
      check('the probe ran', false, message(e));
    } finally {
      PS.of = origOf;
      if (hadOwnSetState) app.setState = savedSetState; else delete app.setState;
      app._piano = savedPiano; app._tp = savedTp; app._perf = savedPerf; app._sim = savedSim;
      Object.assign(S, saved);
      setMode('legacy');
    }
    return out;
  }

  /* ---- a song whose graph does not state its music ---- */
  async function fallbacks(item) {
    const out = [];
    const check = (name, ok, detail) => out.push({ name: name, ok: !!ok, detail: ok ? '' : String(detail || '') });
    const app = window.PPPEngrave.app;
    const origResolve = app.resolveSync;
    const stats = () => PPP.practiceStats.practiceFallback;
    const fresh = async () => loadScore(item);
    try {
      setMode('graph');
      await PPP.loadPracticeModule();
      /* the control: a song that resolves is planned from its graph, and nothing is counted */
      {
        const sc = await fresh();
        const g0 = PPP.practiceStats.graph, f0 = stats().total;
        const plan = PPP.practicePlan(sc);
        check('a song that resolves gets a graph plan', plan.graph && PPP.practiceStats.graph === g0 + 1, 'plan.graph ' + J(plan.graph));
        check('...and no fallback is counted', stats().total === f0, stats().total + ' vs ' + f0);
        check('...and asking again gives the same plan, counted once', PPP.practicePlan(sc) === plan && PPP.practiceStats.graph === g0 + 1);
        check('the graph plan names the Score notes (strike.note)', plan.strikes.length > 0 && plan.strikes.every(s => sc.notes.indexOf(s.note) >= 0 && s.ev && s.head));
      }
      /* each way a source can fail: the legacy plan comes back (the very object PianoScore.of gives), the fallback is counted by reason and by song */
      const modes = {
        LINK_FAILED: (sc, real) => ({ graph: real.graph, via: 'live', link: { ok: false, mismatch: 'planted', byNote: [] } }),
        NO_GRAPH: () => ({ graph: null, via: 'none', link: { ok: false, byNote: [] } }),
        IDENTITY: (sc, real) => ({ graph: real.graph, via: 'live', link: { ok: true, byNote: [] } }),
        MEASURES: (sc, real) => ({ graph: Object.assign({}, real.graph, { timeline: Object.assign({}, real.graph.timeline, { measures: real.graph.timeline.measures.slice(0, -1) }) }), via: 'live', link: real.link }),
        BUILD_ERROR: (sc, real) => ({ graph: Object.assign({}, real.graph, { parts: null }), via: 'live', link: real.link }),
        RESOLVE_ERROR: () => { throw new Error('planted'); }
      };
      for (const reason of Object.keys(modes)) {
        const sc = await fresh();
        const real = origResolve.call(app, sc);
        app.resolveSync = function (s) { return s === sc ? modes[reason](sc, real) : origResolve.call(this, s); };
        try {
          const f0 = stats().total, r0 = stats().reasons[reason] || 0, g0 = PPP.practiceStats.graph;
          let plan = null, threw = null;
          try { plan = PPP.practicePlan(sc, Score.first(sc), Score.last(sc)); } catch (e) { threw = e; }
          check(reason + ': nothing is thrown', !threw, message(threw));
          check(reason + ': the plan is the legacy plan', plan && !plan.graph && plan === PPP.PianoScore.of(sc, Score.first(sc), Score.last(sc)), plan && J(Object.keys(plan)));
          check(reason + ': counted once, with its reason', stats().total === f0 + 1 && (stats().reasons[reason] || 0) === r0 + 1 && PPP.practiceStats.graph === g0, J(stats().reasons));
          const song = stats().bySong[String(sc.id)];
          check(reason + ': counted for the song', song && song.total === 1 && song.reasons[reason] === 1, J(song));
          check(reason + ': asking again is not counted again', PPP.practicePlan(sc, Score.first(sc), Score.last(sc)) === plan && stats().total === f0 + 1);
          /* the player plays on the legacy plan: the scheduler's queue is the legacy one */
          const c = { mode: 'audio', hands: 'both', loop: false, range: { from: Score.first(sc), to: Score.last(sc) } };
          setMode('legacy');
          const a = runCase(sc, c);
          setMode('graph');
          const b = runCase(sc, c);
          check(reason + ': playback is not held up (the same notes are queued)', a.log.notes.length > 0 && J(a.log) === J(b.log) && !b.usedGraph, a.log.notes.length + ' notes');
          /* a different range is another decision */
          const wins = C.windows(sc, 1, 7);
          if (wins[0]) { PPP.practicePlan(sc, wins[0].from, wins[0].to); check(reason + ': another range is counted on its own', stats().total === f0 + 2, stats().total + ' vs ' + (f0 + 2)); }
        } finally { app.resolveSync = origResolve; }
      }
      /* a decision that could change is made again when something has changed (here: the engraver resolved another Score) */
      {
        const sc = await fresh();
        const real = origResolve.call(app, sc);
        let broken = true;
        app.resolveSync = function (s) { return s === sc && broken ? { graph: null, via: 'none', link: { ok: false, byNote: [] } } : origResolve.call(this, s); };
        try {
          const p1 = PPP.practicePlan(sc);
          check('a fallback stays while nothing has changed', !p1.graph && PPP.practicePlan(sc) === p1);
          broken = false;
          const other = await fresh();       // a new Score: the engraver's counters move
          origResolve.call(app, other);
          const p2 = PPP.practicePlan(sc);
          check('...and is decided again when the engraver has resolved something', !!p2.graph && p2 !== p1, J(Object.keys(p2).slice(0, 6)));
        } finally { app.resolveSync = origResolve; }
        void real;
      }
      /* ...but not for ever: five decisions at most (a Score that never resolves is not looked at on every change of the engraver), and a graph that disagrees with the Score is decided once */
      {
        const sc = await fresh();
        app.resolveSync = function (s) { return s === sc ? { graph: null, via: 'none', link: { ok: false, byNote: [] } } : origResolve.call(this, s); };
        try {
          const f0 = stats().total;
          PPP.practicePlan(sc);
          for (let i = 0; i < 9; i++) { origResolve.call(app, await fresh()); PPP.practicePlan(sc); }
          check('a fallback whose reason can change is decided at most five times (ten asks, the engraver busy in between)', stats().total - f0 === 5, stats().total - f0);
        } finally { app.resolveSync = origResolve; }
        const sc2 = await fresh();
        const real2 = origResolve.call(app, sc2);
        app.resolveSync = function (s) { return s === sc2 ? { graph: Object.assign({}, real2.graph, { parts: null }), via: 'live', link: real2.link } : origResolve.call(this, s); };
        try {
          const f0 = stats().total;
          PPP.practicePlan(sc2);
          for (let i = 0; i < 3; i++) { origResolve.call(app, await fresh()); PPP.practicePlan(sc2); }
          check('a plan that cannot be built is decided once, whatever the engraver does next', stats().total - f0 === 1, stats().total - f0);
        } finally { app.resolveSync = origResolve; }
      }
    } catch (e) {
      check('the fallback probe ran', false, message(e));
    } finally {
      app.resolveSync = origResolve;
      setMode('legacy');
    }
    return out;
  }

  /* ---- the corpus under 'graph' ---- */
  const keyOf = n => [n.m, round(n.b), n.staff, n.voice, n.midi].join('|');
  async function sweep(items, o) {
    o = o || {};
    const SGL = window.PPPScoreGraph.legacy;
    const out = [];
    setMode('graph');
    try {
      for (const item of items) {
        const rec = { file: item.file, via: null, linkOk: false, graph: 0, fallback: 0, reasons: {}, fail: [] };
        try {
          const score = await loadScore(item);
          const src = window.PPPEngrave.app.resolveSync(score);
          rec.via = src && src.via; rec.linkOk = !!(src && src.link && src.link.ok);
          const first = Score.first(score), last = Score.last(score);
          const wins = C.windows(score, 3, C.cyrb64(item.file)[1]);
          const noteSet = new Set(score.notes);
          const ranges = [{ from: first, to: last }].concat(wins);
          for (const r of ranges) {
            const fb0 = PPP.practiceStats.practiceFallback, t0 = fb0.total, reasons0 = Object.assign({}, fb0.reasons);
            const gp = PPP.practicePlan(score, r.from, r.to), lp = PPP.PianoScore.of(score, r.from, r.to);
            if (gp.graph) rec.graph++;
            if (PPP.practiceStats.practiceFallback.total > t0) {
              rec.fallback++;
              Object.keys(PPP.practiceStats.practiceFallback.reasons).forEach(k => { if ((PPP.practiceStats.practiceFallback.reasons[k] || 0) > (reasons0[k] || 0)) rec.reasons[k] = (rec.reasons[k] || 0) + 1; });
            }
            if (!gp.graph) { if (gp !== lp) rec.fail.push('[' + r.from + '..' + r.to + '] a fallback that is not the legacy plan'); continue; }
            /* the plan is the legacy plan to the bit, and what hangs on a Score note answers for the Score's notes */
            if (J(C.planOf(gp)) !== J(C.planOf(lp))) rec.fail.push('[' + r.from + '..' + r.to + '] the plan differs from the legacy plan');
            let bad = 0;
            gp.strikes.forEach((s, i) => {
              const l = lp.strikes[i];
              if (!noteSet.has(s.note) || keyOf(s.note) !== keyOf(l.note)) bad++;
            });
            if (bad) rec.fail.push('[' + r.from + '..' + r.to + '] ' + bad + ' strike(s) name a note that is not the legacy plan\'s');
            let holdBad = 0;
            lp.hold.forEach((q, n) => { const g = gp.hold.get(n); if (g === undefined || Math.abs(g - q) > 1e-9) holdBad++; });
            lp.cont.forEach(n => { if (!gp.cont.has(n)) holdBad++; });
            let contExtra = 0;
            gp.cont.forEach(n => { if (typeof n === 'object' && !lp.cont.has(n)) contExtra++; });
            if (holdBad || contExtra) rec.fail.push('[' + r.from + '..' + r.to + '] hold/cont: ' + holdBad + ' missing, ' + contExtra + ' extra for the Score notes');
            /* a strike that is struck is struck, and one that is carried is not, whichever way PianoScore.struck is asked */
            if (gp.strikes.some(s => !PPP.PianoScore.struck(gp, s.note))) rec.fail.push('[' + r.from + '..' + r.to + '] PianoScore.struck says a struck note is carried');
          }
          if (o.projected) {
            /* the plan made from a graph the Score is projected into (the source of a song nobody has the producer's graph of) */
            const fr = SGL.fromScore(score, {});
            if (fr.ok) {
              const link = SGL.link(score, fr.graph);
              rec.projLinkOk = link.ok;
              if (link.ok) {
                const bp = PPP.practiceGraphBuild(score, first, last, { graph: fr.graph, link: link, via: 'projected' });
                rec.projPlan = !!bp.plan;
                rec.projSame = bp.plan ? J(C.planOf(bp.plan)) === J(C.planOf(PPP.PianoScore.of(score, first, last))) : null;
                if (!bp.plan) rec.projReason = bp.reason;
              }
            } else rec.projLinkOk = null;
          }
        } catch (e) {
          rec.error = message(e);
        }
        out.push(rec);
      }
    } finally { setMode('legacy'); }
    return out;
  }

  /* ---- how long a plan takes ---- */
  async function perf(item, o) {
    o = o || {};
    const rounds = o.rounds || 7, per = o.per || 15;
    const score = await loadScore(item);
    const a = Score.first(score), b = Score.last(score);
    const src = window.PPPEngrave.app.resolveSync(score);
    const med = xs => xs.slice().sort((x, y) => x - y)[(xs.length - 1) >> 1];
    const time = fn => {
      for (let i = 0; i < 4; i++) fn();
      const rs = [];
      for (let r = 0; r < rounds; r++) { const t0 = performance.now(); for (let i = 0; i < per; i++) fn(); rs.push((performance.now() - t0) / per); }
      return med(rs);
    };
    setMode('graph');
    try { await PPP.loadPracticeModule(); } finally { setMode('legacy'); }
    const legacy = time(() => PPP.PianoScore.build(score, a, b));
    const graph = time(() => PPP.practiceGraphBuild(score, a, b, src));
    const planOnly = time(() => window.PPPPractice.plan.build(src.graph, { range: { from: 0, to: score.measures.length - 1 }, defaultQpm: score.tempo, legacyCompat: true }));
    const resolve = time(() => window.PPPEngrave.app.resolveSync(score));
    /* the first plan of a Score the page has just made: cold, as the page meets it */
    const cold = [];
    for (let i = 0; i < 4; i++) {
      const s1 = await loadScore(item), s2 = await loadScore(item);
      window.PPPEngrave.app.resolveSync(s2);
      setMode('graph');
      let t1, t2;
      try {
        const t0 = performance.now(); PPP.PianoScore.of(s1, Score.first(s1), Score.last(s1)); t1 = performance.now() - t0;
        const t00 = performance.now(); PPP.practicePlan(s2, Score.first(s2), Score.last(s2)); t2 = performance.now() - t00;
      } finally { setMode('legacy'); }
      cold.push([t1, t2]);
    }
    return { file: item.file, notes: score.notes.filter(n => !n.rest).length, legacy: legacy, graph: graph, planOnly: planOnly, resolveSync: resolve,
      coldLegacy: med(cold.map(c => c[0])), coldGraph: med(cold.map(c => c[1])) };
  }

  window.PPPSwitchProbe = { loadScore: loadScore, runCase: runCase, leak: leak, spies: spies, matcher: matcher, visual: visual, gates: gates, fallbacks: fallbacks, sweep: sweep, perf: perf };
})();
