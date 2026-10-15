/* ============================================================================
   PPP.learner 'adaptive' (G11b-3): the policy of practice/policy.js feeds the recommendation card, the Loop panel's sequence and what the deterministic coach is told
   docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 21; practice/learner.js, practice/policy.js

   These sections belong to tests/learner-log.test.js (the suite of PPP.learner) and are run from its main: `LL_ONLY=adswitch,adcard node tests/learner-log.test.js`. Real pages
   (headless Chrome against the tree's server). The laps are made by the practice simulator's synthetic learners (practice/sim.js, the one G11b-0 wrote) and go through the page's
   OWN PerformanceEngine and completeLap, exactly as tests/practice-sim/runner.js drives the legacy app in a vm; nothing here replaces the page's code.

     adswitch   PPP.learner has a third word: 'adaptive' (default stays legacy), the address, the remembered choice, garbage, the setter, Settings > Labs; the two modules are asked for
                only then, and 'adaptive' implies the typed log; under 'legacy' and 'typed' the page holds no adaptive state and writes no new key
     adcard     a weak left hand, a clean piece, a piece nobody has played: the card is the policy's task with a reason in the person's language, every task passes Coach.validate,
                the same laps give the same advice twice, and the deterministic coach's plan is the policy's
     adseq      the Loop panel's sequence for a passage is the policy's plan in Learning.practiceSequence's shape; the legacy steps come back when there is no model
     adtempo    U6: a tempo step is a suggestion with one tap; the automatic switch is off by default, remembered, and changes the tempo between laps only while it is on
     adlocale   a language change rebuilds every sentence the policy made (the card, the steps, the plan)
     addemo     U4: a lap without a keyboard writes no evidence and moves no model
     adfallback a plan that does not pass Coach.validate, a module that does not load, a model that is not there yet: the legacy card and steps, counted
     adpersist  the policy's state is kept per epoch (song id + music hash): a reload keeps it, a new music hash and a variant copy start again
     adbudget   the cost of a decision, of the page's context and of the load at CPU 4x over a 10-minute simulated session
     adui       the Labs card and the practice card's row in four languages
   ========================================================================== */
'use strict';
const path = require('path');

const SIM_FILE = path.join(__dirname, '..', '..', 'practice', 'sim.js');

/* ---------------------------------------------------------------- a small piece of known shape */
const PITCH = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/* n bars of 4/4 at 84: four quarter notes in the treble (the melody climbs and falls), two half notes in the bass */
function musicXml(n, title) {
  const note = (step, oct, dur, type, staff, voice) => '<note><pitch><step>' + step + '</step><octave>' + oct + '</octave></pitch><duration>' + dur + '</duration><voice>' + voice + '</voice><type>' + type + '</type><staff>' + staff + '</staff></note>';
  let bars = '';
  for (let i = 0; i < n; i++) {
    let m = '<measure number="' + (i + 1) + '">';
    if (i === 0) {
      m += '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
        '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
        '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>84</per-minute></metronome></direction-type><sound tempo="84"/></direction>';
    }
    for (let k = 0; k < 4; k++) m += note(PITCH[(i + k * 2) % 7], 4 + (((i + k) % 7) > 4 ? 1 : 0), 1, 'quarter', 1, 1);
    m += '<backup><duration>4</duration></backup>';
    m += note(PITCH[(i * 3) % 7], 3, 2, 'half', 2, 2) + note(PITCH[(i * 3 + 4) % 7], 3, 2, 'half', 2, 2);
    m += '</measure>';
    bars += m;
  }
  return '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>' + (title || 'Adaptive test piece') + '</work-title></work>' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' + bars + '</part></score-partwise>';
}

/* ---------------------------------------------------------------- in the page */
/* adopt the piece, give it a synthetic learner (practice/sim.js, already in the page) and wait for the model of its epoch.
   cfg: { xml, name, type, seed, dR, dL, hard: [{from, to, hand, add}] , waitReady } */
function setupInPage(cfg) {
  return (async () => {
    const A = PPP.app, SIM = window.PPPPracticeSim, sl = ms => new Promise(r => setTimeout(r, ms));
    const sc = PPP.parseMusicXML(cfg.xml, cfg.name || 'adaptive-test.musicxml');
    A.adoptScore(sc);
    A.enterSong(sc, { kind: 'musicxml' }, false, null);     /* a song of its own in My Songs (its own id), so that a reload brings the same one back */
    await sl(250);
    const score = A.state.score;
    const idx = {};
    score.measures.forEach((mm, i) => { if (idx[mm.number] == null) idx[mm.number] = i; });
    const plan = PPP.PianoScore.of(score);
    const notes = score.measures.map(() => ({ r: 0, l: 0 }));
    const seen = new Set();
    plan.strikes.forEach(s => { if ((s.hand === 'r' || s.hand === 'l') && !seen.has(s.note)) { seen.add(s.note); notes[idx[s.m]][s.hand]++; } });
    const piece = {
      id: 'adaptive-test',
      measures: score.measures.map((mm, i) => {
        const d = { r: cfg.dR == null ? 0.6 : cfg.dR, l: cfg.dL == null ? 0.7 : cfg.dL };
        (cfg.hard || []).forEach(h => { if (mm.number >= h.from && mm.number <= h.to) d[h.hand] += h.add; });
        return { index: i, d: d, notes: notes[i] };
      })
    };
    const T0 = cfg.t0 === 'now' ? Date.now() : 1790000000000;      /* 'now': a clock a reload of this page continues (a fixed one makes a new session of it) */
    const L = SIM.makeLearner(cfg.type || 'even', piece, cfg.seed || 11, T0);
    window.__ad = { L: L, g: SIM.rng(SIM.hashSeed('play|' + (cfg.seed || 11))), idx: idx, now: T0, day: 0, score: score, minutes: 0 };
    PPP.Clock.now = () => window.__ad.now;
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), screen: 'player', loop: true, practiceMode: 'practice', hands: 'both' });
    if (cfg.waitReady !== false) {
      const t0 = performance.now();
      while (performance.now() - t0 < 15000) {
        const r = PPP.adaptive;
        if (r && r.ready && r.decision && A.state.score === score) break;
        await sl(60);
      }
    }
    await sl(150);
    const r = PPP.adaptive;
    return { measures: score.measures.length, ready: !!(r && r.ready), notes: notes.reduce((s, n) => s + n.r + n.l, 0), numbers: score.measures.map(m => m.number) };
  })();
}

/* one lap of the synthetic learner through the page's own matcher and completeLap; the patch is applied and flushed before this returns.
   o: { gapMs (time since the last lap, added to the page's clock), advanceDay } */
function lapInPage(o) {
  return (async () => {
    o = o || {};
    const A = PPP.app, SIM = window.PPPPracticeSim, W = window.__ad;
    const S = A.state, score = S.score;
    if (o.gapMs) W.now += o.gapMs;
    if (o.newDay) W.day++;
    const [from, to] = A.range(S);
    const ratio = S.tempo / (score.tempo || 84);
    const memory = S.practiceMode === 'memory';
    const ctx = { ratio: ratio, both: S.hands === 'both', hide: 0, fatigue: SIM.fatigueAt(W.minutes) };
    SIM.advance(W.L, W.now);
    A.beginRun(S, PPP.Score.startQ(score, from), W.now);
    const perf = A._perf;
    const notes = perf.expected.map(x => ({ midi: x.midi, tMs: x.tMs, i: W.idx[x.m], hand: x.hand === 'l' ? 'l' : 'r', rep: String(W.idx[x.m]), q: Math.round(x.tMs) }));
    const play = SIM.perform(W.L, notes, ctx, W.g);
    play.events.forEach(ev => perf.noteOn(ev));
    const plan = perf._plan, scale = perf._scale;
    const lapMs = PPP.PianoScore.msAt(plan, plan.soundLengthQ, scale) - PPP.PianoScore.msAt(plan, 0, scale);
    perf.advanceTo(perf.run.startedAt + PPP.PianoScore.msAt(plan, plan.soundLengthQ, scale) + perf.timing.window + 1);
    const live = perf.live(), result = perf.result();
    const t0 = performance.now();
    const patch = Object.assign({ beat: PPP.Score.startQ(score, from), runHit: live.matched, runTot: live.seen }, A.completeLap(S, live.matched, live.seen, result));
    const cost = performance.now() - t0;
    await new Promise(r => A.setState(patch, r));
    SIM.practise(W.L, play.reps, ctx, W.day);
    W.now += lapMs + 4000; W.minutes += (lapMs + 4000) / 60000;
    return { from: from, to: to, hands: S.hands, pct: Math.round(ratio * 100), acc: Math.round(result.accuracy * 100), cost: cost, memory: memory, patchTempo: patch.tempo == null ? null : patch.tempo };
  })();
}

/* take the card's button (applyRecommendation) and play n laps, noting what the card said each time; opts.follow = false plays the page as it is */
function followCardInPage(o) {
  return (async () => {
    const A = PPP.app, out = [];
    for (let i = 0; i < o.n; i++) {
      const rec = A.recommendation();
      if (o.keepTempo) { A.setLoop(rec.from, rec.to); A.setState({ hands: rec.hands, practiceMode: rec.mode === 'memory' ? 'memory' : 'practice', screen: 'player', loop: true }); }
      else if (o.take !== false) A.applyRecommendation(rec);
      await new Promise(r => setTimeout(r, 30));
      const lap = await window.__lapInPage({ gapMs: o.gapMs || 0, newDay: !!(o.dayEvery && i && i % o.dayEvery === 0) });
      out.push({ card: { from: rec.from, to: rec.to, hands: rec.hands, tempoPct: rec.tempoPct, mode: rec.mode, kind: rec.kind, headline: rec.headline, adaptive: !!rec.adaptive }, lap: lap });
    }
    return out;
  })();
}

/* ---------------------------------------------------------------- the sections */
async function run(browser, h, want) {
  const { open, toPractice, toSettings, ok, sleep, errors } = h;
  const fs = require('fs');
  const simSource = fs.readFileSync(SIM_FILE, 'utf8');
  /* a page with the simulator and the lap helpers in it */
  const withSim = async page => {
    await page.evaluate(src => { (0, eval)(src); }, simSource);
    await page.evaluate(lapInPage_ => { window.__lapInPage = new Function('return (' + lapInPage_ + ')')(); }, lapInPage.toString());
  };
  const pageWith = async (o, cfg) => {
    const p = await open(browser, o);
    await withSim(p.page);
    const s = await p.page.evaluate(setupInPage, cfg);
    return Object.assign(p, { setup: s });
  };
  const report = p => p.page.evaluate(() => PPP.adaptive);
  const laps = (p, o) => p.page.evaluate(followCardInPage, o);
  const XML24 = musicXml(24);

  /* ============================== adswitch */
  if (want('adswitch')) {
    console.log('\n── PPP.learner has a third word, adaptive: the same switch as the other two ──');
    const KEY = 'ppp.learner.v1';
    const probe = async (query, init) => {
      const p = await open(browser, { query: query, init: init || [] });
      await sleep(900);
      const r = await p.page.evaluate(() => ({
        learner: PPP.learner, adaptive: PPP.adaptive ? { ready: PPP.adaptive.ready } : null, learnerMod: typeof window.PPPLearner, policyMod: typeof window.PPPPolicy, runlogMod: typeof window.PPPRunLog,
        key: (() => { try { return localStorage.getItem('ppp.learner.v1'); } catch (e) { return 'throws'; } })(),
        keys: Object.keys(localStorage).filter(k => /^ppp\.adaptive/.test(k))
      }));
      r.requests = p.probe.requests.slice();
      r.all = p.probe.all.slice();
      r.errors = p.probe.errors;
      await p.close();
      return r;
    };
    const seenAdaptive = r => r.all.filter(u => /practice\/(learner|policy)\.js/.test(u)).length;
    const a = await probe('');
    ok('the default is still legacy: no adaptive state, neither module requested, no key of its own', a.learner === 'legacy' && a.adaptive === null && seenAdaptive(a) === 0 && a.learnerMod === 'undefined' && a.policyMod === 'undefined' && a.keys.length === 0, JSON.stringify(a));
    const t = await probe('?learner=typed');
    ok('?learner=typed asks for the run log and for nothing of the policy', t.learner === 'typed' && t.runlogMod === 'object' && seenAdaptive(t) === 0 && t.adaptive === null, JSON.stringify({ l: t.learner, mod: t.runlogMod, req: seenAdaptive(t) }));
    const d = await probe('?learner=adaptive');
    ok('?learner=adaptive: the third word, and it implies the typed log (runlog.js, learner.js and policy.js asked for, once each)', d.learner === 'adaptive' && d.runlogMod === 'object' && d.learnerMod === 'object' && d.policyMod === 'object' && seenAdaptive(d) === 2 && d.all.filter(u => /runlog\.js/.test(u)).length === 1, JSON.stringify({ l: d.learner, all: d.all }));
    ok('and a choice made in the address is not remembered', d.key === null);
    const rem = await probe('', [[v => { localStorage.setItem('ppp.learner.v1', v); }, 'adaptive']]);
    ok('a remembered adaptive is adaptive, and the model of the sample is built', rem.learner === 'adaptive' && rem.learnerMod === 'object', rem.learner);
    const junk = [await probe('', [[v => { localStorage.setItem('ppp.learner.v1', v); }, 'ADAPTIVE']]), await probe('?learner=adaptiv'), await probe('?learner=Adaptive'), await probe('', [[v => { localStorage.setItem('ppp.learner.v1', v); }, 'on']])];
    ok('a typo, the wrong case or another word is no choice: legacy, nothing requested', junk.every(r => r.learner === 'legacy' && seenAdaptive(r) === 0 && r.adaptive === null), junk.map(r => r.learner).join(','));
    const over = await probe('?learner=legacy', [[v => { localStorage.setItem('ppp.learner.v1', v); }, 'adaptive']]);
    ok('the address beats the remembered choice', over.learner === 'legacy' && seenAdaptive(over) === 0);

    /* the setter and Settings > Labs, on one page */
    const p = await open(browser, {});
    await toSettings(p.page);
    const labs0 = await p.page.evaluate(() => { const r = document.querySelector('[data-labs-row="adaptive"]'); return r ? { text: r.innerText, pressed: r.querySelector('[data-labs-toggle]').getAttribute('aria-pressed') } : null; });
    ok('Settings has a Labs card with one row, off', !!labs0 && labs0.pressed === 'false' && /Adaptive practice/.test(labs0.text) && /Off\./.test(labs0.text), JSON.stringify(labs0));
    await p.page.evaluate(() => document.querySelector('[data-labs-toggle="adaptive"]').click());
    await sleep(1500);
    const on = await p.page.evaluate(() => ({ learner: PPP.learner, key: localStorage.getItem('ppp.learner.v1'), mod: typeof window.PPPPolicy, ready: PPP.adaptive && PPP.adaptive.ready, pressed: document.querySelector('[data-labs-toggle="adaptive"]').getAttribute('aria-pressed'), card: !!document.querySelector('[data-run-log-settings]') }));
    ok('pressing it turns adaptive on at once: remembered, both modules in, the model built, the practice log card shown (it implies the typed log)', on.learner === 'adaptive' && on.key === 'adaptive' && on.mod === 'object' && on.ready === true && on.pressed === 'true' && on.card, JSON.stringify(on));
    await p.page.evaluate(() => document.querySelector('[data-labs-toggle="adaptive"]').click());
    await sleep(600);
    const off = await p.page.evaluate(() => ({ learner: PPP.learner, key: localStorage.getItem('ppp.learner.v1'), adaptive: PPP.adaptive, card: !!document.querySelector('[data-run-log-settings]') }));
    ok('and pressing it again puts the page back: legacy, nothing remembered, no adaptive state, no practice log card', off.learner === 'legacy' && off.key === null && off.adaptive === null && !off.card, JSON.stringify(off));
    const setter = await p.page.evaluate(async () => { PPP.learner = 'adaptive'; await new Promise(r => setTimeout(r, 1200)); const a = PPP.learner; PPP.learner = 'typed'; await new Promise(r => setTimeout(r, 200)); return { a: a, t: PPP.learner, ad: PPP.adaptive }; });
    ok('PPP.learner = ... follows at once, both ways, and typed is not adaptive', setter.a === 'adaptive' && setter.t === 'typed' && setter.ad === null, JSON.stringify(setter));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();

    /* legacy and typed hold no adaptive state through a whole practice session */
    for (const q of ['', '?learner=typed']) {
      const pp = await pageWith({ query: q }, { xml: XML24, type: 'even', seed: 5, waitReady: false });
      const r = await laps(pp, { n: 6, take: false });
      const s = await pp.page.evaluate(() => ({ ad: PPP.adaptive, keys: Object.keys(localStorage).filter(k => /^ppp\.adaptive/.test(k)), card: PPP.app.recommendation().adaptive === true, mod: typeof window.PPPPolicy, steps: PPP.app._ad === undefined || PPP.app._ad === null }));
      ok((q || 'legacy') + ': six laps leave no adaptive state: no report, no key, no adaptive card, no module', s.ad === null && s.keys.length === 0 && !s.card && s.mod === 'undefined' && s.steps && r.length === 6, JSON.stringify(s));
      await pp.close();
    }
  }

  /* ============================== adcard */
  if (want('adcard')) {
    console.log('\n── the recommendation card is the policy\'s task, with a reason, validated; the same laps give the same advice; the coach plan is the policy\'s ──');
    const session = async () => {
      const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'weak-left', seed: 31, dR: 0.5, dL: 0.6, hard: [{ from: 9, to: 12, hand: 'l', add: 2.4 }] });
      const first = await p.page.evaluate(() => { const r = PPP.app.recommendation(); return { adaptive: !!r.adaptive, from: r.from, to: r.to, kind: r.kind, headline: r.headline, action: r.action, mode: r.mode, tempoPct: r.tempoPct }; });
      const run1 = await laps(p, { n: 14, dayEvery: 7, gapMs: 60000 });
      return { p: p, first: first, run: run1 };
    };
    const A1 = await session();
    ok('before a note is played the card is the policy\'s first reading of the whole piece (not the legacy first eight bars), with a reason without a figure', A1.first.adaptive && A1.first.kind === 'assess' && A1.first.from === 1 && A1.first.to === 24 && /PPP has not heard measures 1–24 yet/.test(A1.first.headline) && !/\d+\s*%/.test(A1.first.headline), JSON.stringify(A1.first));
    const cards = A1.run.map(x => x.card);
    const hardBars = cards.filter(c => c.from <= 12 && c.to >= 9);
    ok('after the first reading the card goes to the passage that is weak (bars 9-12 are hard for the left hand): ' + hardBars.length + ' of ' + (cards.length - 1) + ' later cards cover them', cards.length === 14 && hardBars.length >= 3, cards.map(c => c.from + '-' + c.to + ' ' + c.hands + ' ' + c.tempoPct + '%').join(' | '));
    const leftNamed = cards.some(c => /left hand/i.test(c.headline) || c.hands === 'left');
    ok('and says why in words: the left hand is named (a left-hand task or its reason)', leftNamed, cards.map(c => c.headline).join(' | '));
    ok('every card was the policy\'s (adaptive), none the legacy one', cards.every(c => c.adaptive), cards.map(c => c.adaptive).join(','));
    const rep = await report(A1.p);
    ok('the model read every lap (14 updates, none refused) and decided 14 times + 1 (the first)', rep.updates === 14 && Object.keys(rep.refused).length === 0 && rep.decisions >= 15, JSON.stringify({ u: rep.updates, r: rep.refused, d: rep.decisions }));
    ok('and nothing fell back: no rejected card, no rejected plan', !rep.fallbacks['rec-rejected'] && !rep.fallbacks['plan-rejected'] && rep.errors === 0, JSON.stringify({ fb: rep.fallbacks, e: rep.errors }));
    const guard = await A1.p.page.evaluate(() => {
      const A = PPP.app, rec = A.recommendation();
      const ctx = A.coachContext(true);
      const v = PPP.Coach.validate({ summary: '', todayGoal: '', coachNote: '', sessionMinutes: 10, tasks: [{ range: { start: rec.from, end: rec.to }, hand: rec.hands, tempoPercent: rec.tempoPct, mode: rec.mode, repetitions: 2, reason: rec.headline }] }, ctx);
      const full = A.coachContext();
      const det = PPP.Coach.deterministicPlan(full);
      const checked = PPP.Coach.validate(JSON.parse(JSON.stringify(det)), full);
      return { ok: v.ok, issues: v.issues.length, card: { from: rec.from, to: rec.to, hands: rec.hands, tempoPct: rec.tempoPct }, task: v.plan && v.plan.tasks[0], adaptive: !!full.adaptive, summary: full.adaptive && full.adaptive.summary, planTasks: full.adaptive && full.adaptive.plan ? full.adaptive.plan.tasks.length : 0,
        detSame: JSON.stringify(det) === JSON.stringify(full.adaptive && full.adaptive.plan), checkedOk: checked.ok, checkedIssues: checked.issues.length, perc: full.allowed.percentages.length,
        listed: A.state.coachPlan ? A.state.coachPlan.tasks.map(t => t.range.start + '-' + t.range.end + ' ' + t.hand + ' ' + t.tempoPercent) : null, noLLM: JSON.stringify(full).length > 0 };
    });
    ok('the card\'s task goes through Coach.validate whole: ok, no repair, no drop', guard.ok && guard.issues === 0 && !!guard.task && guard.task.range.start === guard.card.from && guard.task.range.end === guard.card.to && guard.task.hand === guard.card.hands && guard.task.tempoPercent === guard.card.tempoPct, JSON.stringify(guard.task));
    const gs = guard.summary || { runs: -1, focus: null, passages: [] };
    ok('Coach.context carries the model\'s summary (runs, focus, the weakest passages as measured percentages, reviews due) and the policy\'s validated plan', guard.adaptive && !!gs.focus && gs.runs === 14 && gs.passages.length >= 1 && typeof gs.passages[0].accuracy === 'number' && guard.planTasks >= 1, JSON.stringify(guard.summary));
    ok('the deterministic coach answers with that plan, and it passes validate again untouched', guard.detSame && guard.checkedOk && guard.checkedIssues === 0, JSON.stringify({ same: guard.detSame, ok: guard.checkedOk, i: guard.checkedIssues }));
    const sums = gs.passages[0] || {};
    ok('the summary names the weak left hand: the weakest passage overlaps bars 9-12 and its left accuracy is below its right accuracy', sums.from <= 12 && sums.to >= 9 && sums.leftAccuracy != null && sums.rightAccuracy != null && sums.leftAccuracy < sums.rightAccuracy, JSON.stringify(sums));
    const coachList = await A1.p.page.evaluate(async () => { await PPP.app.requestPlan({ keepDone: true }); const pl = PPP.app.state.coachPlan; return pl ? { src: PPP.app.state.coachSource, tasks: pl.tasks.map(t => ({ s: t.range.start, e: t.range.end, h: t.hand, p: t.tempoPercent, why: t.reason })), goal: pl.todayGoal } : null; });
    ok('the session\'s list on the practice page is made from it, planned by PPP, each task with a reason', coachList && coachList.src === 'PPP' && coachList.tasks.length >= 1 && coachList.tasks.every(t => t.why && t.why.length > 8), JSON.stringify(coachList));
    /* U8: the LLM coach stays off - the deterministic coach answers even where a service is reachable, and the model's summary is never in what a service is sent */
    const llm = await A1.p.page.evaluate(async () => {
      const A = PPP.app;
      A.setState({ coachAi: true });
      await new Promise(r => setTimeout(r, 80));
      const local = A.coachProvider() === PPP.Coach.providers.local;
      const ctx = A.coachContext();
      let body = null;
      const f = window.fetch;
      window.fetch = (u, o) => {
        if (/\/coach$/.test(String(u))) body = o && o.body;
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'stub' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      };
      try { await PPP.Coach.providers.service.generate(ctx); } catch (e) { /* the stub refuses */ }
      window.fetch = f;
      const sent = body ? Object.keys(JSON.parse(body).context) : null;
      A.setState({ coachAi: false });
      return { local: local, hadAdaptive: !!ctx.adaptive, sent: sent };
    });
    ok('U8: with an AI service reachable the provider is still the local one, and what a service would be sent has no model summary and no plan of the policy', llm.local && llm.hadAdaptive && Array.isArray(llm.sent) && llm.sent.indexOf('song') >= 0 && llm.sent.indexOf('adaptive') < 0, JSON.stringify(llm));
    const seqA = cards.map(c => [c.from, c.to, c.hands, c.tempoPct, c.kind].join(':')).join(',');
    await A1.p.close();
    /* the same learner (seed), the same laps: the same advice, lap for lap */
    const A2 = await session();
    const seqB = A2.run.map(x => x.card).map(c => [c.from, c.to, c.hands, c.tempoPct, c.kind].join(':')).join(',');
    ok('the same synthetic learner in a fresh page gets the same cards, lap for lap (deterministic)', seqA === seqB && A1.first.headline === A2.first.headline, seqA + '\n      ' + seqB);
    await A2.p.close();
    /* a clean piece: the card does not invent work (it asks for a run through, or memory work where the gate allows) */
    const C = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'even', seed: 3, dR: -2.5, dL: -2.5 });
    const cl = await laps(C, { n: 6, dayEvery: 3 });
    const last = cl[cl.length - 1].card;
    ok('a piece the learner plays cleanly: no hand alone, no slowing down - hands together at 90 % or more (the cards re-check windows the model knows little of, up to 16 bars)', cl.every(x => x.card.hands === 'both' && x.card.tempoPct >= 90), cl.map(x => x.card.from + '-' + x.card.to + ' ' + x.card.hands + ' ' + x.card.tempoPct + '% ' + x.card.mode).join(' | '));
    ok('no page error', C.probe.errors.length === 0, C.probe.errors.join('|'));
    await C.close();
  }

  /* ============================== adseq */
  if (want('adseq')) {
    console.log('\n── the Loop panel\'s sequence is the policy\'s plan for the passage, in the legacy shape ──');
    const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'weak-left', seed: 31, dR: 0.5, dL: 0.6, hard: [{ from: 9, to: 12, hand: 'l', add: 2.4 }] });
    await laps(p, { n: 8, dayEvery: 4 });
    const s = await p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      const legacy = bars => PPP.Learning.practiceSequence(A.state.score, A.state.history, bars[0], bars[1]);
      const at = async (from, to) => { A.setLoop(from, to); A.setState({ practiceMode: 'practice' }); await sl(80); return A.seq(); };
      const hard = await at(9, 12), easy = await at(17, 20), whole = await at(1, 24);
      const shape = st => st.every(x => typeof x.label === 'string' && x.label && (x.hands === 'both' || x.hands === 'left' || x.hands === 'right') && x.tempoPct >= 40 && x.tempoPct <= 100 && x.reps >= 1 && x.reps <= 8);
      return { hard: hard, easy: easy, whole: whole, shape: [hard, easy, whole].every(shape), legacyHard: legacy([9, 12]), card: document.body.innerText.indexOf('This passage') >= 0 };
    });
    ok('the steps keep the legacy shape {label, hands, tempoPct, reps} for the weak passage, an untouched one and the whole piece', s.shape && s.hard.length >= 1 && s.easy.length >= 1 && s.whole.length >= 1, JSON.stringify(s.hard));
    ok('for the passage the left hand fails in, the first step is the left hand alone', s.hard[0].hands === 'left' && /Left hand alone/.test(s.hard[0].label), JSON.stringify(s.hard));
    ok('and it is not the legacy sequence', JSON.stringify(s.hard) !== JSON.stringify(s.legacyHard), JSON.stringify(s.legacyHard));
    ok('the tempos of the steps rise (never below 40 %, never above 100 %)', s.hard.every((x, i) => i === 0 || x.tempoPct >= s.hard[i - 1].tempoPct || x.hands === 'both'), JSON.stringify(s.hard.map(x => x.hands + x.tempoPct)));
    const dom = await p.page.evaluate(async () => {
      const sl = ms => new Promise(r => setTimeout(r, ms));
      PPP.app.setState({ screen: 'player' });
      PPP.app.setLoop(9, 12);
      await sl(200);
      const tab = [...document.querySelectorAll('main [role=tab]')].find(x => /Loop a passage/.test((x.innerText || '').trim()));
      if (tab) tab.click();
      await sl(400);
      return { tab: !!tab, text: document.body.innerText.indexOf('Left hand alone') >= 0 };
    });
    ok('the panel draws them (the left hand alone is on the page)', dom.text, JSON.stringify(dom));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
  }

  /* ============================== adtempo */
  if (want('adtempo')) {
    console.log('\n── U6: the tempo is suggested with one tap; the automatic switch is off, remembered, and only then changes it ──');
    const mk = async (extra) => pageWith(Object.assign({ query: '?learner=adaptive' }, extra || {}), { xml: XML24, type: 'even', seed: 21, dR: 2.0, dL: 2.2 });
    const p = await mk();
    const before = await p.page.evaluate(() => ({ auto: PPP.adaptive.auto, key: localStorage.getItem('ppp.adaptiveTempo.v1') }));
    ok('the automatic switch is off by default and nothing is remembered', before.auto === false && before.key === null, JSON.stringify(before));
    /* play the card until the policy steps the tempo on the passage it works on */
    let seen = null;
    for (let i = 0; i < 24 && !seen; i++) {
      await laps(p, { n: 1, dayEvery: 5, keepTempo: true });
      seen = await p.page.evaluate(() => { const r = PPP.adaptive; return r.suggest ? { suggest: r.suggest, tempo: PPP.app.state.tempo, tempoSteps: r.tempoSteps, score: PPP.app.state.score.tempo, chip: !!document.querySelector('[data-adaptive-suggest]') } : null; });
    }
    ok('a tempo step comes as a suggestion: the chip is on the practice card and the tempo is still what the person had', !!seen && seen.chip && Math.abs(seen.tempo / seen.score * 100 - seen.suggest.pct) >= 3, JSON.stringify(seen));
    if (seen) {
      const tap = await p.page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        const g = PPP.adaptive.suggest;
        document.querySelector('[data-adaptive-apply]').click();
        await sl(250);
        return { want: Math.round(PPP.app.state.score.tempo * g.pct / 100), tempo: PPP.app.state.tempo, chip: !!document.querySelector('[data-adaptive-suggest]'), suggest: PPP.adaptive.suggest };
      });
      ok('one tap sets that tempo and the suggestion is gone', Math.abs(tap.tempo - tap.want) <= 1 && !tap.chip && tap.suggest === null, JSON.stringify(tap));
    }
    /* turning the switch on: remembered, and the tempo changes between laps by itself */
    await p.page.evaluate(() => { PPP.app.setState({ screen: 'player' }); });
    await sleep(300);
    await p.page.evaluate(() => document.querySelector('[data-adaptive-auto]').click());
    await sleep(300);
    const on = await p.page.evaluate(() => ({ auto: PPP.adaptive.auto, key: localStorage.getItem('ppp.adaptiveTempo.v1'), pressed: document.querySelector('[data-adaptive-auto]').getAttribute('aria-pressed') }));
    ok('the switch turns on and is remembered on this device', on.auto === true && on.key === 'on' && on.pressed === 'true', JSON.stringify(on));
    const before2 = await p.page.evaluate(() => PPP.adaptive.autoApplied);
    let moved = null;
    for (let i = 0; i < 40 && !moved; i++) {
      const r = await laps(p, { n: 1, dayEvery: 5, keepTempo: true });
      const t0 = await p.page.evaluate(() => ({ tempo: PPP.app.state.tempo, ap: PPP.adaptive.autoApplied, chip: !!document.querySelector('[data-adaptive-suggest]') }));
      if (t0.ap > before2) moved = Object.assign({ lapTempo: r[0].lap.pct }, t0);
    }
    ok('while it is on the policy\'s step is applied between laps (autoApplied counted, no chip left over)', !!moved && !moved.chip, JSON.stringify(moved));
    await p.close();
    /* a passage the person picked: the Loop panel's next step carries a tempo; with the switch off it is offered, with it on it is applied at the lap boundary */
    for (const auto of [false, true]) {
      const r = await pageWith({ query: '?learner=adaptive', init: auto ? [[() => { localStorage.setItem('ppp.adaptiveTempo.v1', 'on'); }, null]] : [] },
        { xml: XML24, type: 'even', seed: 21, dR: 0.6, dL: 0.7, hard: [{ from: 9, to: 12, hand: 'r', add: 3.2 }, { from: 9, to: 12, hand: 'l', add: 3.2 }, { from: 17, to: 20, hand: 'r', add: 2.6 }, { from: 17, to: 20, hand: 'l', add: 2.6 }] });
      await laps(r, { n: 1 });
      /* two laps of the passage at the score tempo, so that the model knows it is hard */
      await r.page.evaluate(async () => {
        const A = PPP.app;
        A.setLoop(17, 20);
        A.setState({ hands: 'both', tempo: A.state.score.tempo, loop: true, practiceMode: 'practice', seqStep: 0, seqReps: 0 });
        await new Promise(x => setTimeout(x, 60));
        for (let i = 0; i < 4; i++) await window.__lapInPage({});
      });
      const st = await r.page.evaluate(async () => {
        const A = PPP.app, sl = ms => new Promise(x => setTimeout(x, ms));
        const rows = A.seq().map(x => ({ h: x.hands, p: x.tempoPct, n: x.reps }));
        const ownTask = PPP.adaptive.decision && PPP.adaptive.decision.task;
        A.setState({ seqStep: 0, seqReps: 0, tempo: Math.round(A.state.score.tempo * rows[0].p / 100), hands: rows[0].h });
        await sl(80);
        const owns = !!(ownTask && ownTask.range.start === 17 && ownTask.range.end === 20);
        const before = A.state.tempo;
        for (let i = 0; i < rows[0].n; i++) await window.__lapInPage({});
        await sl(120);
        return { rows: rows, owns: owns, before: before, after: A.state.tempo, want: rows[1] ? Math.round(A.state.score.tempo * rows[1].p / 100) : null, suggest: PPP.adaptive.suggest, step: A.state.seqStep };
      });
      const label = auto ? 'on' : 'off';
      ok('a passage a person picked, switch ' + label + ': the Loop panel has steps whose tempos differ (the plan for a hard passage)', st.rows.length >= 2 && st.rows[1].p !== st.rows[0].p && !st.owns, JSON.stringify(st.rows) + ' policy owns: ' + st.owns);
      if (auto) ok('switch on: when its repetitions are done the next step\'s tempo is applied at the lap boundary', st.rows.length >= 2 && st.after === st.want && st.step === 1, JSON.stringify(st));
      else ok('switch off: the next step\'s tempo is not applied, it is offered as a suggestion (one tap)', st.rows.length >= 2 && st.after === st.before && !!st.suggest && st.suggest.pct === st.rows[1].p && st.step === 1, JSON.stringify(st));
      ok('no page error', r.probe.errors.length === 0, r.probe.errors.join('|'));
      await r.close();
    }
    /* a new page: the choice is remembered, and turned off again, forgotten */
    const q = await pageWith({ query: '?learner=adaptive', init: [[() => { localStorage.setItem('ppp.adaptiveTempo.v1', 'on'); }, null]] }, { xml: XML24, type: 'even', seed: 21 });
    const rem = await q.page.evaluate(() => ({ auto: PPP.adaptive.auto }));
    ok('a new visit keeps it on', rem.auto === true, JSON.stringify(rem));
    await q.page.evaluate(() => { PPP.app.toggleAdaptiveAuto(); });
    const gone = await q.page.evaluate(() => ({ auto: PPP.adaptive.auto, key: localStorage.getItem('ppp.adaptiveTempo.v1') }));
    ok('and turning it off forgets it', gone.auto === false && gone.key === null, JSON.stringify(gone));
    ok('no page error', q.probe.errors.length === 0, q.probe.errors.join('|'));
    await q.close();
  }

  /* ============================== adlocale */
  if (want('adlocale')) {
    console.log('\n── a change of language rebuilds the policy\'s sentences: the card, the steps and the plan ──');
    const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'weak-left', seed: 31, dR: 0.5, dL: 0.6, hard: [{ from: 9, to: 12, hand: 'l', add: 2.4 }] });
    await laps(p, { n: 7, dayEvery: 4 });
    const grab = () => p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      await A.requestPlan({ keepDone: true });
      await sl(100);
      const rec = A.recommendation();
      A.setLoop(rec.from, rec.to);
      await sl(100);
      return { headline: rec.headline, action: rec.action, step: A.seq().map(s => s.label).join('|'), reason: A.state.coachPlan ? A.state.coachPlan.tasks.map(t => t.reason).join('|') : '', goal: A.state.coachPlan ? A.state.coachPlan.todayGoal : '' };
    });
    const en = await grab();
    await p.page.evaluate(async () => { window.PPP_I18N.setLocale('ko-KR'); await new Promise(r => setTimeout(r, 1500)); });
    const ko = await grab();
    const hangul = s => /[가-힣]/.test(s);
    ok('English first: the card, the steps and the plan are English', !hangul(en.headline) && !hangul(en.step) && !hangul(en.reason), JSON.stringify(en));
    ok('after the language changes to Korean the card says why in Korean (no stale English)', hangul(ko.headline) && !/Still shaky|still shaky|has not heard|Check |clean at this tempo|too many notes|steady enough|Everything you/.test(ko.headline) && hangul(ko.action), JSON.stringify(ko));
    ok('and so do the steps of the Loop panel and the reasons of the session\'s plan', hangul(ko.step) && hangul(ko.reason) && hangul(ko.goal), JSON.stringify({ step: ko.step, reason: ko.reason, goal: ko.goal }));
    ok('the Korean sentence names the bars the way a teacher would say them (…마디)', /\d+(–\d+)?마디|마디 \d+/.test(ko.headline + ko.action), ko.headline + ' / ' + ko.action);
    await p.page.evaluate(async () => { window.PPP_I18N.setLocale('en-US'); await new Promise(r => setTimeout(r, 1500)); });
    const en2 = await grab();
    ok('and back to English: the sentences are English again', !hangul(en2.headline) && !hangul(en2.step) && en2.headline === en.headline, JSON.stringify(en2));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
  }

  /* ============================== addemo */
  if (want('addemo')) {
    console.log('\n── U4: a lap without a keyboard writes no evidence and moves no model ──');
    const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'even', seed: 9 });
    const demo = await p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      const r0 = PPP.adaptive;
      const out = { u0: r0.updates, d0: r0.decisions, v0: r0.version, runs0: r0.runs, hist0: A.state.history.runs.length };
      /* five laps ending with no matcher result: Demo Input */
      for (let i = 0; i < 5; i++) {
        A._sim = A.newSim();
        const S = A.state;
        const ev = A.fire(S, 0, 1e6);
        const patch = A.completeLap(S, ev.hit, ev.tot, null);
        A.setState(patch);
        await sl(120);
      }
      const r1 = PPP.adaptive;
      out.u1 = r1.updates; out.d1 = r1.decisions; out.v1 = r1.version; out.runs1 = r1.runs; out.laps = A.state.laps; out.refused = r1.refused; out.stored = r1.stored;
      out.log = await (async () => { const l = PPP.runLog.log; const eps = (await l.epochs()).epochs; return eps.length ? { runs: eps[0].runs, sim: eps[0].sim.n } : { runs: 0, sim: 0 }; })();
      out.hist = A.state.history.runs.length;
      return out;
    });
    ok('five Demo Input laps move the screen (the lap counter) and nothing else: no model update, no decision, no run in the log, the epoch counts them', demo.u1 === demo.u0 && demo.d1 === demo.d0 && demo.v1 === demo.v0 && demo.runs1 === demo.runs0 && demo.laps >= 5 && demo.log.runs === 0 && demo.log.sim >= 5, JSON.stringify(demo));
    ok('the legacy aggregates did not move either (U4: the history has no run)', demo.hist === demo.hist0, demo.hist0 + ' -> ' + demo.hist);
    const real = await laps(p, { n: 1, take: false });
    const after = await report(p);
    ok('a lap with a result is evidence: one update, one more decision', after.updates === demo.u0 + 1 && after.decisions === demo.d0 + 1, JSON.stringify({ u: after.updates, d: after.decisions }));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
  }

  /* ============================== adfallback */
  if (want('adfallback')) {
    console.log('\n── a plan that does not pass Coach.validate, a module that does not load, a model that is not there yet: the legacy card, counted ──');
    const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'weak-left', seed: 31, dR: 0.5, dL: 0.6, hard: [{ from: 9, to: 12, hand: 'l', add: 2.4 }] });
    await laps(p, { n: 4 });
    const g = await p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      const was = A.recommendation();
      const legacy = (() => { const m = A.model(); return PPP.Memory.nextTask(A.state.score, A.state.history, A.state.memory, { now: PPP.Clock.now(), base: m.rec, ranges: m.ranges }); })();
      const real = PPP.Coach.validate;
      PPP.Coach.validate = () => ({ ok: false, issues: [{ level: 'reject', message: 'stub' }], plan: null });
      PPP.app._ad.rec = null; PPP.app._ad.steps = null;
      A.setState({ adaptiveRev: (A.state.adaptiveRev || 0) + 1 });
      await sl(100);
      const fb = A.recommendation();
      const full = A.coachContext();
      const det = PPP.Coach.deterministicPlan(full);
      PPP.Coach.validate = real;
      return { adaptiveWas: !!was.adaptive, fbAdaptive: !!fb.adaptive, fbSame: fb.from === legacy.from && fb.to === legacy.to && fb.headline === legacy.headline, ctxAdaptivePlan: !!(full.adaptive && full.adaptive.plan), detIsLegacy: !(full.adaptive && full.adaptive.plan) && det.tasks.length >= 1, fallbacks: PPP.adaptive.fallbacks };
    });
    ok('a validate that rejects: the card is the legacy recommendation, the context has no adaptive plan, the coach answers its own plan, and the reasons are counted', g.adaptiveWas && !g.fbAdaptive && g.fbSame && !g.ctxAdaptivePlan && g.detIsLegacy && g.fallbacks['rec-rejected'] >= 1 && g.fallbacks['plan-rejected'] >= 1, JSON.stringify(g));
    const back = await p.page.evaluate(async () => { PPP.app._ad.rec = null; PPP.app.setState({ adaptiveRev: 99 }); await new Promise(r => setTimeout(r, 100)); return !!PPP.app.recommendation().adaptive; });
    ok('and when validate passes again the policy\'s card is back', back === true);
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
    /* the policy module does not load: the legacy page, with a count, no error */
    const q = await open(browser, { query: '?learner=adaptive', block: /practice\/policy\.js/ });
    await sleep(2500);
    const r = await q.page.evaluate(() => ({ learner: PPP.learner, ad: PPP.adaptive, rec: PPP.app.recommendation(), seq: PPP.app.seq().length }));
    ok('a policy that cannot be had: still adaptive by name, never ready, the legacy card and steps, "modules" counted', r.learner === 'adaptive' && r.ad && r.ad.ready === false && r.ad.fallbacks.modules >= 1 && !r.rec.adaptive && r.seq >= 1, JSON.stringify({ l: r.learner, ready: r.ad && r.ad.ready, fb: r.ad && r.ad.fallbacks }));
    ok('and no page error', q.probe.errors.length === 0, q.probe.errors.join('|'));
    await q.close();
  }

  /* ============================== adpersist */
  if (want('adpersist')) {
    console.log('\n── the policy\'s state is kept per epoch (song id + music hash): a reload keeps it, a new music hash or a variant copy starts again ──');
    const p = await pageWith({ query: '?learner=adaptive' }, { xml: XML24, type: 'weak-left', seed: 31, dR: 0.5, dL: 0.6, hard: [{ from: 9, to: 12, hand: 'l', add: 2.4 }], t0: 'now' });
    await laps(p, { n: 9, dayEvery: 5 });
    await sleep(900);
    const a = await report(p);
    const key = a.songId + '|' + a.hash;
    const stored = await p.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ppp.adaptive.v1')); } catch (e) { return null; } });
    ok('the policy\'s state is in localStorage under song id | music hash (a small JSON), next to the run log\'s epoch', !!stored && !!stored.songs[key] && stored.songs[key].st.session >= 1 && JSON.stringify(stored).length < 20000, Object.keys((stored && stored.songs) || {}).join(','));
    /* a reload of the same song: the same tune goes on (the page keeps its song, the log has the runs) */
    await p.page.evaluate(() => { PPP.app.saveNow(); });
    await sleep(500);
    await p.page.reload({ waitUntil: 'domcontentloaded' });
    await p.page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.adaptive && window.PPP.adaptive.ready && window.PPP.adaptive.decision, { timeout: 30000 });
    await sleep(500);
    const b = await report(p);
    ok('after a reload the model is rebuilt from the run log (the same 9 runs) and the policy resumes its session and focus', b.runs === a.runs && b.state.session === a.state.session && JSON.stringify(b.state.focus && [b.state.focus.a, b.state.focus.b, b.state.focus.kind]) === JSON.stringify(a.state.focus && [a.state.focus.a, a.state.focus.b, a.state.focus.kind]), JSON.stringify({ a: [a.runs, a.state.session, a.state.focus && a.state.focus.a], b: [b.runs, b.state.session, b.state.focus && b.state.focus.a] }));
    /* a new music hash is a new epoch: the model has no runs, the state is fresh, the old key is kept */
    const c = await p.page.evaluate(async cfg => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      const sc = PPP.parseMusicXML(cfg.xml, 'edited.musicxml');
      A.adoptScore(sc);
      await sl(300);
      const t0 = performance.now();
      while (performance.now() - t0 < 10000) { const r = PPP.adaptive; if (r && r.ready && r.decision && A.state.score === sc && r.hash) break; await sl(60); }
      const r = PPP.adaptive;
      return { hash: r.hash, runs: r.runs, session: r.state.session, keys: Object.keys(JSON.parse(localStorage.getItem('ppp.adaptive.v1')).songs) };
    }, { xml: musicXml(24, 'Edited piece').replace('<step>C</step><octave>4</octave>', '<step>D</step><octave>4</octave>').replace(/<step>E<\/step><octave>5<\/octave>/, '<step>F</step><octave>5</octave>') });
    ok('an edited piece (a new music hash) is a new epoch: no runs, a new session, the old epoch\'s state is still kept', c.hash !== a.hash && c.runs === 0 && c.session === 1 && c.keys.indexOf(key) >= 0, JSON.stringify({ old: a.hash, now: c.hash, runs: c.runs, keys: c.keys.length }));
    /* a variant copy is its own song: the same music under another song id has its own epoch */
    const e = await p.page.evaluate(async cfg => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      const sc = PPP.parseMusicXML(cfg.xml, 'edited.musicxml');
      A.setState({ songId: 'song-variant-test' });
      A.adoptScore(sc);
      await sl(300);
      const t0 = performance.now();
      while (performance.now() - t0 < 10000) { const r = PPP.adaptive; if (r && r.ready && r.decision && r.songId === 'song-variant-test') break; await sl(60); }
      const r = PPP.adaptive;
      return { songId: r.songId, runs: r.runs, session: r.state.session };
    }, { xml: musicXml(24, 'Adaptive test piece') });
    ok('the same music under another song id (the copy a variant makes) is its own song: no runs of the original', e.songId === 'song-variant-test' && e.runs === 0, JSON.stringify(e));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
  }

  /* ============================== adbudget */
  if (want('adbudget')) {
    const calib = await h.calibration(browser);
    const scale = Math.min(3, Math.max(1, calib / h.CALIB_REF));
    console.log('\n── budgets at CPU 4x: a 10-minute simulated session (the policy, the model\'s update, the context, the load) ──');
    const p = await open(browser, { query: '?learner=adaptive', cpu: 4 });
    await withSim(p.page);
    const s0 = await p.page.evaluate(setupInPage, { xml: musicXml(64, 'Long test piece'), type: 'beginner', seed: 44, dR: 0.9, dL: 1.1, hard: [{ from: 20, to: 30, hand: 'l', add: 1.5 }] });
    /* the policy's and the model's own functions timed where they run, and the page's long tasks */
    await p.page.evaluate(() => {
      window.__t = { decide: [], update: [], longtasks: [] };
      const P = window.PPPPolicy, L = window.PPPLearner;
      const dec = P.decide, upd = L.update;
      /* both modules are frozen objects: replace the page's references instead */
      window.PPPPolicy = Object.assign({}, P, { decide: function () { const t = performance.now(); try { return dec.apply(P, arguments); } finally { window.__t.decide.push(performance.now() - t); } } });
      window.PPPLearner = Object.assign({}, L, { update: function () { const t = performance.now(); try { return upd.apply(L, arguments); } finally { window.__t.update.push(performance.now() - t); } } });
      try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__t.longtasks.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) { /* not available */ }
    });
    const t0 = Date.now();
    const rows = [];
    const sessionOf = async (gapMs) => {      /* laps of the card until 10 simulated minutes have been played (a lap costs its music + 4 s) */
      const m0 = await p.page.evaluate(() => window.__ad.minutes);
      for (let chunk = 0; chunk < 80; chunk++) {
        const r = await laps(p, { n: 3, gapMs: chunk === 0 ? gapMs : 0, newDay: chunk === 0 && gapMs > 0 });
        r.forEach(x => rows.push(x));
        const mins = await p.page.evaluate(() => window.__ad.minutes);
        if (mins - m0 >= 10) break;
      }
    };
    await sessionOf(0);
    const first = await p.page.evaluate(() => { const r = PPP.adaptive; return { minutes: window.__ad.minutes, laps: PPP.app.state.laps, updates: r.updates, decisions: r.decisions, errors: r.errors, ms: r.ms.slice(), ctx: r.ctxMs.slice(), longtasks: window.__t.longtasks.slice() }; });
    /* three more sessions on later days, for a sample worth a percentile */
    for (let k = 0; k < 3; k++) await sessionOf(26 * 3600 * 1000);
    const m = await p.page.evaluate(() => {
      const r = PPP.adaptive;
      return { decide: window.__t.decide.slice(), update: window.__t.update.slice(), ms: r.ms, ctx: r.ctxMs, longtasks: window.__t.longtasks.slice(), decisions: r.decisions, updates: r.updates, minutes: window.__ad.minutes, fallbacks: r.fallbacks, errors: r.errors, laps: PPP.app.state.laps };
    });
    const at = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const mx = a => (a.length ? Math.max.apply(null, a) : 0);
    const lapCost = rows.map(x => x.lap.cost);
    ok('the first session: ' + first.laps + ' laps in ' + first.minutes.toFixed(1) + ' simulated minutes, every lap read by the model and decided on, no error', first.minutes >= 10 && first.updates === first.laps && first.decisions >= first.laps && first.errors === 0, JSON.stringify({ laps: first.laps, min: first.minutes, u: first.updates, d: first.decisions, e: first.errors }));
    ok('and in it no step of the policy is a long task: the worst decision ' + mx(first.ms).toFixed(1) + ' ms, the worst context ' + mx(first.ctx).toFixed(1) + ' ms (limit 50)', mx(first.ms) < 50 && mx(first.ctx) < 50);
    /* THE RULE of the budget section of this suite: Chrome's CPU throttle slows a short task 1x to 5x depending on where in its duty cycle it falls, and another process only ever ADDS time; so the median and the
       p90 are held over the whole sample and the p90 also in either half of it (a loaded machine has to be loaded for both), scaled by this machine's speed. The worst task is reported and held under 50 ms. */
    const halves = [m.ms.slice(0, Math.ceil(m.ms.length / 2)), m.ms.slice(Math.ceil(m.ms.length / 2))];
    ok('4 sessions, ' + m.laps + ' laps: a decision of the policy is within 2 ms at CPU 4x - median ' + at(m.ms, 0.5).toFixed(2) + ', p90 ' + at(m.ms, 0.9).toFixed(2) + ' (halves ' + at(halves[0], 0.9).toFixed(2) + ' / ' + at(halves[1], 0.9).toFixed(2) + '), max ' + mx(m.ms).toFixed(2) + ' ms over ' + m.ms.length + ' (limits 1 and 2 ms x ' + scale.toFixed(2) + ' for this machine)', m.ms.length >= 40 && at(m.ms, 0.5) <= 1 * scale && (at(m.ms, 0.9) <= 2 * scale || halves.some(r => at(r, 0.9) <= 2 * scale)));
    ok('the model update of a lap: median ' + at(m.update, 0.5).toFixed(2) + ' p90 ' + at(m.update, 0.9).toFixed(2) + ' max ' + mx(m.update).toFixed(2) + ' ms (limit 5 ms at p90 x ' + scale.toFixed(2) + ')', at(m.update, 0.9) <= 5 * scale || at(m.update.slice(0, Math.ceil(m.update.length / 2)), 0.9) <= 5 * scale || at(m.update.slice(Math.ceil(m.update.length / 2)), 0.9) <= 5 * scale);
    ok('no step of the policy is a long task in any session: the worst decision ' + mx(m.decide).toFixed(1) + ' ms (with the context it asks for), the worst update ' + mx(m.update).toFixed(1) + ' ms, the worst context ' + mx(m.ctx).toFixed(1) + ' ms (all under 50 x ' + scale.toFixed(2) + ')', mx(m.decide) < 50 * scale && mx(m.update) < 50 * scale && mx(m.ctx) < 50 * scale);
    ok('the whole completeLap of a lap (the legacy work, the run log entry, the model, the decision): median ' + at(lapCost, 0.5).toFixed(1) + ' p90 ' + at(lapCost, 0.9).toFixed(1) + ' max ' + mx(lapCost).toFixed(1) + ' ms (for scale; the long tasks of the page itself at 4x, not the policy: ' + JSON.stringify(m.longtasks.slice(0, 10)) + ')', at(lapCost, 0.9) < 50 * scale);
    ok('nothing fell back and no page error', Object.keys(m.fallbacks).filter(k => k !== 'no-model').length === 0 && p.probe.errors.length === 0, JSON.stringify(m.fallbacks) + ' ' + p.probe.errors.join('|'));
    console.log('      (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s of wall clock; this machine ' + calib.toFixed(0) + ' ms on the reference workload)');
    await p.close();
  }

  /* ============================== adui */
  if (want('adui')) {
    console.log('\n── Settings > Labs and the practice card\'s row, in four languages ──');
    const L = {
      'en-US': { labs: 'Labs', row: 'Adaptive practice', off: 'Off. Press to turn it on.', on: 'On. Press to turn it off.', auto: 'Change the tempo by itself between runs' },
      'ko-KR': { labs: '실험 기능', row: '맞춤 연습 추천', off: '꺼져 있어요. 누르면 켜요.', on: '켜져 있어요. 누르면 꺼요.', auto: '한 번 칠 때마다 빠르기를 알아서 바꿔요' },
      'ja-JP': { labs: '実験機能', row: 'あなたに合わせた練習', off: 'オフです。押すとオンにします。', on: 'オンです。押すとオフにします。', auto: '一回弾くごとに速さを自動で変える' },
      'zh-CN': { labs: '实验功能', row: '个性化练习推荐', off: '已关闭。点按可开启。', on: '已开启。点按可关闭。', auto: '每弹一遍自动调整速度' }
    };
    for (const loc of Object.keys(L)) {
      const x = L[loc];
      const p = await open(browser, { init: [[l => { localStorage.setItem('ppp-locale', l); }, loc]] });
      await toSettings(p.page);
      const lab = await p.page.evaluate(() => { const s = document.querySelector('[data-labs-section]'); return s ? s.innerText : null; });
      ok(loc + ': Settings > Labs reads ' + x.labs + ' / ' + x.row + ' / ' + x.off, !!lab && lab.indexOf(x.labs) >= 0 && lab.indexOf(x.row) >= 0 && lab.indexOf(x.off) >= 0, JSON.stringify(lab));
      await p.page.evaluate(() => document.querySelector('[data-labs-toggle="adaptive"]').click());
      await sleep(1200);
      await toPractice(p.page, false);
      const row = await p.page.evaluate(() => { const r = document.querySelector('[data-adaptive-row]'); return r ? r.innerText : null; });
      ok(loc + ': once on, the practice card has the switch ' + x.auto, !!row && row.indexOf(x.auto) >= 0, JSON.stringify(row));
      ok(loc + ': no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
      await p.close();
    }
    const p = await open(browser, {});
    await toPractice(p.page, false);
    const leg = await p.page.evaluate(() => ({ row: !!document.querySelector('[data-adaptive-row]'), body: document.body.innerText }));
    ok('under legacy the practice card has no adaptive row and no word of it', !leg.row && !/Change the tempo by itself|PPP suggests/.test(leg.body));
    await p.close();
  }
}

module.exports = { run, musicXml, setupInPage, lapInPage, followCardInPage };
