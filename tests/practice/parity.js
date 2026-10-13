/* G11a-2: THE EVENT-PARITY HARNESS (docs/GOALS/G11 section 6.2). Is the plan practice/plan.js makes from the ScoreGraph the plan the app plays today, and is every
   difference that the fix options make one the design allows?

   For every piece of the corpus - the 325 catalogue files (the licence-quarantined ones are measured and only counted, never named), the 40 engraving fixtures
   (tests/engrave/fixtures/e), the 29 ScoreGraph reader fixtures (tests/scoregraph/fixtures/xml), the G11a-1 fixtures (tests/practice/fixtures) and the new hand-written
   ones (tests/practice/fixtures/parity) - read through the app's own door (PPP.scoreFromXml, whose graph PPPEngrave.app.resolveSync hands back), in the running page,
   with practice/plan.js added by addScriptTag (the app itself does not load practice/ until G11a-3):

     plan      PianoScore.build against PPPPractice.plan.build in compat mode (the default: every fix off): visits, strikes, controller events, beats, tempo map,
               pedal spans - one string per side, the same canon.js function (strictOf). Whole piece and up to 20 seeded four-bar loop windows (the ones that end on a
               backward repeat and start in a volta first). Zero differences allowed, to the last bit.
     ids       every strike's event/head is the one PPPEngrave identity gives its Score note; every visit names its measure
     begin     PerformanceEngine.begin's expected list on each plan for every range x hands (both, right, left) x tempo (1, 0.5)
     matcher   six scripted performances (perfect, +80 ms, a wrong key every 7th note, 10 % missed, chords rolled over 60 ms, an arpeggio 300 ms late) through the
               PerformanceEngine, which reads the plan through PianoScore.of: the page's own function is swapped for the new plan for the duration of one synchronous
               run. Every result object, per measure and hand, and every note's verdict and signed timing, must be the same.
     gates     follow mode's gates (the app's own followGates) against practice/plan.js followGates, every range x hands
     fixes     the same plan with the fix options on (jumps 'once', graces 'play'; followGates repeats, ties), every difference booked to JUMP, GRACE, FOLLOW_REPEAT or
               FOLLOW_TIE by the rule table in parity-core.js; anything else is UNEXPLAINED and fails. Each option alone is checked too.
     scheduler the app's real startTransport/schedule on a fake piano and a fake MIDI output at 8x the written tempo, legacy plan against new plan, on 12 pieces: every
               note on and off, controller event and metronome click, both hands, the right, the left, and two looped windows

   Report: tests/practice/out/parity.json (per file, per cause; the quarantined lot as totals only). The committed summary is tests/practice/baselines/parity.json.

     node tests/practice/parity.js check                     the whole corpus
     node tests/practice/parity.js check --sample 5          every 5th catalogue file, the fixtures, and every file the baseline gives a cause (the PR run)
     node tests/practice/parity.js check --shard 2/4         every 4th file of the corpus, starting at the second (the CI jobs that split the corpus use this)
     node tests/practice/parity.js check --only SUBSTR       the files whose path contains SUBSTR (no baseline comparison of totals)
     node tests/practice/parity.js record                    rewrite the baseline (do this when the plan or the corpus is CHANGED ON PURPOSE; the diff is the review)
     node tests/practice/parity.js show PATH                 one file's record (never a licence-quarantined one)
   Options: --url URL (a page already served), --windows N, --no-spies, --out FILE, --plan-src FILE (a copy of practice/plan.js to test: the mutation check). */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Canon = require('./canon');

const BASELINE = path.join(__dirname, 'baselines', 'parity.json');
const PLAN_SRC = path.join(L.ROOT, 'practice', 'plan.js');
const CORE_SRC = path.join(__dirname, 'parity-core.js');
const OUT = path.join(__dirname, 'out', 'parity.json');
const DEFAULTS = { windows: 20 };
const BATCH = 4;
/* the pieces the real scheduler is run on: a long one, dynamics, pedals of every kind, an 8va, jumps, voltas, a pickup, ties, a tempo change, a 6/4 hymn, an arpeggio */
const SPY_FILES = [
  'catalog/method/sonatina/020.mxl', 'catalog/hymns/all-creatures.musicxml',
  'tests/engrave/fixtures/e/E16-dynamics-hairpins.musicxml', 'tests/engrave/fixtures/e/E17-pedal.musicxml', 'tests/engrave/fixtures/e/E18-ottava.musicxml',
  'tests/engrave/fixtures/e/E22-repeats-jumps.musicxml', 'tests/engrave/fixtures/e/E40-arpeggio-gliss.musicxml',
  'tests/scoregraph/fixtures/xml/repeats-endings-1-2.musicxml', 'tests/scoregraph/fixtures/xml/pickup-3-4.musicxml', 'tests/scoregraph/fixtures/xml/ties-slurs.musicxml',
  'tests/practice/fixtures/pedals.musicxml', 'tests/practice/fixtures/tempo-change.musicxml'
];
const FIXTURE_SETS = [['practice-fixtures', 'tests/practice/fixtures'], ['parity-fixtures', 'tests/practice/fixtures/parity']];
const CAUSES = ['JUMP', 'GRACE', 'FOLLOW_REPEAT', 'FOLLOW_TIE'];

/* ---- the corpus: lib.corpus() (the legacy recorder's) and this harness's own fixtures ---- */
function corpus() {
  const list = L.corpus();
  FIXTURE_SETS.forEach(([set, dir]) => {
    const abs = path.join(L.ROOT, dir);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs).filter(f => /\.musicxml$/.test(f)).sort().forEach(f => {
      list.push({ path: dir + '/' + f, set: set, quarantined: false, text: fs.readFileSync(path.join(abs, f), 'utf8') });
    });
  });
  return list;
}

/* ---- in the page: a plan, a window, a verdict. Self-contained: it is serialised into the browser. ---- */
async function parityInPage(items, opts) {
  const C = window.PPPPracticeCanon, X = window.PPPParity, PPP = window.PPP, Score = PPP.Score, PS = PPP.PianoScore;
  const PLAN = window.PPPPractice.plan, SRC = window.PPPEngraveModules.source;
  const proto = Object.getPrototypeOf(PPP.app);
  const J = JSON.stringify;
  const STREAMS = C.STREAMS;
  const origOf = PS.of;
  let override = null;
  PS.of = function (sc, f, t) {
    if (override) { const p = override(sc, f, t); if (p) return p; }
    return origOf.call(this, sc, f, t);
  };
  const legacyGates = (score, from, to, hands) => {
    const fake = { state: { score: score, hands: hands, screen: 'practice', loop: true, loopFrom: from, loopTo: to, practiceMode: 'practice' },
      range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
    return proto.followGates.call(fake);
  };

  async function oneFile(item) {
    const file = item.file;
    const rec = { file: file, k: {}, c: {}, fail: [], nfail: 0, un: [], nun: 0 };
    const k = rec.k;
    const add = (name, n) => { k[name] = (k[name] || 0) + (n === undefined ? 1 : n); };
    const fail = msg => { rec.nfail++; if (rec.fail.length < 6) rec.fail.push(msg); };
    const unexplained = (what, list) => { list.forEach(m => { rec.nun++; if (rec.un.length < 6) rec.un.push(what + ': ' + m); }); };
    try {
      let xml = item.text;
      if (xml == null) {
        const res = await fetch('/' + file);
        xml = /\.mxl$/.test(file) ? await PPP.readMxl(await res.arrayBuffer()) : await res.text();
      }
      const score = PPP.scoreFromXml(xml, file.split('/').pop());
      const src = window.PPPEngrave.app.resolveSync(score);
      if (!src || src.via !== 'live' || !src.link || !src.link.ok) {
        rec.fb = (src && src.via) + (src && src.link && src.link.mismatch ? ':' + J(src.link.mismatch).slice(0, 80) : '');
        return rec;
      }
      const g = src.graph;
      const first = Score.first(score), last = Score.last(score), base = score.tempo || 84, qpm = score.tempo;
      const wins = C.windows(score, opts.windows, C.cyrb64(file)[1]);
      const ranges = [{ from: first, to: last, why: 'whole' }].concat(wins);
      const byKey = new Map();
      ranges.forEach(r => {
        r.i0 = Score.measure(score, r.from).index;
        r.i1 = Score.measure(score, r.to).index;
        byKey.set(r.from + ':' + r.to, r);
      });
      const optsFor = (r, extra) => Object.assign({ range: { from: r.i0, to: r.i1 }, defaultQpm: qpm }, extra || {});
      const nOf = idx => score.measures[idx].number;

      /* what in the graph a fix is about */
      const graceMeasures = new Set();
      let graceEvents = 0;
      const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
      g.parts.forEach(p => p.events.forEach(e => { if (e.grace && e.kind !== 'rest') { graceEvents++; graceMeasures.add(mIdx.get(e.m)); } }));
      rec.c.ge = graceEvents;
      rec.n = score.notes.filter(n => !n.rest).length;
      rec.m = score.measures.length;

      /* the plans: legacy (cached, the one the matcher and the scheduler read), compat, every fix on */
      for (const r of ranges) {
        r.Lp = PS.of(score, r.from, r.to);
        r.Np = PLAN.build(g, optsFor(r));
        r.Na = PLAN.build(g, optsFor(r, { jumps: 'once', graces: 'play' }));
        r.Nview = Object.assign({}, r.Na, { strikes: r.Na.strikes.filter(s => !s.grace) });
        r.dL = X.dumpOf(r.Lp);
        r.dN = X.dumpOf(r.Np);
        r.dA = X.dumpOf(r.Na);
      }
      const whole = ranges[0];

      /* ---- plan: bit for bit ---- */
      for (const r of ranges) {
        const at = '[' + r.from + '..' + r.to + ']';
        add('ranges');
        add('strikes', r.Lp.strikes.length);
        const sl = X.strictOf(r.Lp), sn = X.strictOf(r.Np);
        if (J(sl) !== J(sn)) fail('plan ' + at + ' ' + X.firstDiff(sl, sn));
        else if (J(r.dL) !== J(r.dN)) fail('plan ' + at + ' the visits name other bars or places: ' + J(r.dN.v.slice(0, 2)));
        const rolled = {};
        Score.notesIn(score, r.from, r.to).forEach(n => { if (n.arp) rolled[n.m + '|' + n.b + '|' + (n.staff || 1)] = true; });
        const wrongArp = r.Np.strikes.filter(s => !!rolled[s.note.m + '|' + s.note.b + '|' + (s.note.staff || 1)] !== !!s.arp).length;
        if (wrongArp) fail('plan ' + at + ' ' + wrongArp + ' strike(s) with a rolled-chord flag the matcher would not give');
        /* the explicit compat option is the default */
        if (r === whole && J(X.strictOf(PLAN.build(g, optsFor(r, { legacyCompat: true, jumps: false, graces: false })))) !== J(sn)) fail('plan: legacyCompat:true is not the default');
        if (r === whole) {
          add('helpers');
          const sc = [0.5, 1];
          const probes = [0, 0.3, 1.7, r.Lp.soundLengthQ / 2, r.Lp.soundLengthQ];
          const bad = sc.some(s => probes.some(q => PS.msAt(r.Lp, q, s) !== PS.msAt(r.Np, q, s) || PS.qAt(r.Lp, PS.msAt(r.Lp, q, s), s) !== PS.qAt(r.Np, PS.msAt(r.Np, q, s), s))) ||
            probes.some(q => PS.writtenAtSound(r.Lp, q) !== PS.writtenAtSound(r.Np, q) || PS.soundAtWritten(r.Lp, q) !== PS.soundAtWritten(r.Np, q)) ||
            J(PS.sostSpans(r.Lp)) !== J(PS.sostSpans(r.Np));
          if (bad) fail('plan: msAt/qAt/writtenAtSound/soundAtWritten/sostSpans answer differently on the new plan');
        }
      }

      /* ---- ids ---- */
      {
        const ident = SRC.identity(score, src);
        const by = new Map();
        score.notes.forEach((n, i) => {
          if (n.rest) return;
          const key = n.m + '|' + C.r6(n.b) + '|' + n.staff + '|' + (n.soundingMidi != null ? n.soundingMidi : n.midi);
          if (!by.has(key)) by.set(key, []);
          by.get(key).push(i);
        });
        let bad = 0;
        whole.Np.strikes.forEach(s => {
          add('ids');
          const cands = by.get(s.m + '|' + C.r6(s.note.b) + '|' + s.staff + '|' + s.midi) || [];
          const ok = cands.some(i => ident.byNote[i] === s.ev && (!(src.link.byNote[i] && src.link.byNote[i].head) || !s.head || src.link.byNote[i].head === s.head));
          if (!ok) bad++;
        });
        if (bad) fail('ids: ' + bad + ' strike(s) whose event is not the one identity gives their Score note');
        whole.Np.visits.forEach(v => {
          add('ids');
          if (v.id !== g.timeline.measures[v.index].id || v.number !== score.measures[v.index].number) fail('ids: a visit names another measure than its bar');
        });
      }

      /* ---- the page's own PianoScore.of, swapped for one synchronous run ---- */
      function withPlans(kind, fn) {
        override = kind === 'legacy' ? null : (sc, f, t) => {
          const r = byKey.get(f + ':' + t);
          if (!r) throw new Error('the matcher asked for a range that was not planned: ' + f + ':' + t);
          return kind === 'fix' ? r.Nview : r.Np;
        };
        try { return fn(); } finally { override = null; }
      }
      const beginOf = (kind, r, h, sc) => withPlans(kind, () => {
        const eng = new PPP.PerformanceEngine(score);
        eng.begin({ from: r.from, to: r.to, hands: h, tempo: base * sc, startedAt: 0 });
        return J(C.expectedOf(eng.expected));
      });
      const runOf = (kind, r, h, sc, stream) => withPlans(kind, () => {
        const eng = new PPP.PerformanceEngine(score);
        eng.begin({ from: r.from, to: r.to, hands: h, tempo: base * sc, startedAt: 0 });
        const res = C.replay(eng, C.streamEvents(eng.expected, stream));
        return J(C.outcomeOf(eng, res));
      });
      /* ---- the fixes: the plan, option by option ---- */
      for (const r of ranges) {
        const at = '[' + r.from + '..' + r.to + ']';
        if (J(r.dA) === J(r.dN)) continue;                                  /* no fix acted in this range */
        const Nj = PLAN.build(g, optsFor(r, { jumps: 'once' })), Ng = PLAN.build(g, optsFor(r, { graces: 'play' }));
        const exA = X.explainPlan(r.dL, r.dA, { allow: { JUMP: true, GRACE: true }, graceMeasures: graceMeasures });
        const exJ = X.explainPlan(r.dL, X.dumpOf(Nj), { allow: { JUMP: true }, graceMeasures: graceMeasures });
        const exG = X.explainPlan(r.dL, X.dumpOf(Ng), { allow: { GRACE: true }, graceMeasures: graceMeasures });
        unexplained('plan ' + at + ' (all fixes)', exA.unexplained);
        unexplained('plan ' + at + ' (jumps alone)', exJ.unexplained);
        unexplained('plan ' + at + ' (graces alone)', exG.unexplained);
        if (exJ.jump.turned) add('rangesJump');
        if (exG.grace.strikes) add('rangesGrace');
        if (r === whole) {
          rec.c.jf = exJ.jump.turned;
          rec.c.jv = exJ.jump.visitsAdded;
          rec.c.js = exJ.jump.strikes;
          /* not a cause but a limit of JUMP worth counting: a tie is kept or broken by the NOTE, not by the visit, so a bar that the way back reaches from another bar than the one
             before it on the page (the segno after the D.S., the coda after the To Coda) starts with its tied-to notes silent */
          const na = r.Na;
          rec.c.jt = na.visits.reduce((n, v, j) => {
            const prev = na.visits[j - 1];
            if (!v.leg || (prev && prev.leg && v.index === prev.index + 1)) return n;
            return n + na.written.filter(w => !w.rest && w.hand !== 'x' && w.tieStop && na.cont.has(w.head) && Math.abs(w.abs - v.startQ) < 1e-9).length;
          }, 0);
          rec.c.gs = exG.grace.strikes;
          rec.c.gm = exG.grace.moved;
          rec.c.gc = exG.grace.cut;
        }
        /* what the matcher makes of it: it never expects a grace; the expected notes are the plan's other strikes, and a perfect performance is all matched */
        withPlans('fix', () => {
          const eng = new PPP.PerformanceEngine(score);
          eng.begin({ from: r.from, to: r.to, hands: 'both', tempo: base, startedAt: 0 });
          const want = r.Na.strikes.filter(s => !s.grace && s.hand !== 'x').length;
          const res = C.replay(eng, C.streamEvents(eng.expected, 'perfect'));
          add('matcherFix');
          if (eng.expected.length !== want || res.counts.matched !== res.counts.expected || res.counts.wrong || res.counts.extra)
            unexplained('matcher ' + at + ' (all fixes)', ['expected ' + eng.expected.length + ' of ' + want + ', matched ' + res.counts.matched + ', wrong ' + res.counts.wrong + ', extra ' + res.counts.extra]);
        });
      }

      /* ---- begin and the matcher ---- */
      for (const r of ranges) {
        for (const h of ['both', 'right', 'left']) for (const sc of [1, 0.5]) {
          add('begin');
          if (beginOf('legacy', r, h, sc) !== beginOf('compat', r, h, sc)) fail('begin [' + r.from + '..' + r.to + '] ' + h + ' x' + sc + ': the expected notes differ');
        }
      }
      const jobs = [];
      ['both', 'right', 'left'].forEach(h => [1, 0.5].forEach(sc => STREAMS.forEach(s => jobs.push([whole, h, sc, s]))));
      ranges.slice(1).forEach(r => {
        STREAMS.forEach(s => jobs.push([r, 'both', 1, s]));
        jobs.push([r, 'right', 0.5, 'late80'], [r, 'left', 0.5, 'roll60'], [r, 'left', 1, 'miss10'], [r, 'right', 1, 'wrong7']);
      });
      for (const [r, h, sc, s] of jobs) {
        add('matcher');
        if (runOf('legacy', r, h, sc, s) !== runOf('compat', r, h, sc, s)) fail('matcher [' + r.from + '..' + r.to + '] ' + h + ' x' + sc + ' ' + s + ': the verdicts differ');
      }

      /* ---- follow gates ---- */
      const memo = new Map();
      const lgates = (from, to, h) => {
        const key = from + ':' + to + ':' + h;
        if (!memo.has(key)) memo.set(key, C.gatesOf(legacyGates(score, from, to, h)));
        return memo.get(key);
      };
      const dangling = (cont, from, to, h) => {
        const a = Score.startQ(score, from) - 1e-9, z = Score.endQ(score, to) - 1e-9;
        return score.notes.filter(n => !n.rest && n.midi != null && n.tieStop && !cont.has(n) && n.abs >= a && n.abs < z && proto.handOk(n, h))
          .map(n => [C.r6(n.abs), n.m, n.midi, n.hand === 'l' ? 'l' : 'r']);
      };
      /* the oracle for a play order that repeats: the app's own followGates, once per stretch, in order */
      const stretches = (dump) => X.runsOf(dump).map(run => ({ from: nOf(run.first), to: nOf(run.last), ok: Score.measure(score, nOf(run.first)).index === run.first && Score.measure(score, nOf(run.last)).index === run.last }));
      for (const r of ranges) {
        const at = '[' + r.from + '..' + r.to + ']';
        const runsN = stretches(r.dN), runsA = stretches(r.dA);
        for (const h of ['both', 'right', 'left']) {
          const Lg = lgates(r.from, r.to, h);
          add('gates');
          const G0 = C.gatesOf(PLAN.followGates(r.Np, h));
          const e0 = X.explainGatesExact(Lg, G0);
          if (e0.bad) fail('gates ' + at + ' ' + h + ': ' + e0.unexplained[0]);

          /* FOLLOW_TIE */
          const G1 = C.gatesOf(PLAN.followGates(r.Np, h, { ties: true }));
          const d1 = dangling(r.Lp.cont, r.from, r.to, h);
          const e1 = X.explainGatesTies(Lg, G1, d1);
          unexplained('gates ' + at + ' ' + h + ' (ties)', e1.unexplained);
          if (J(G1) !== J(Lg)) add('rangesTie');
          if (r === whole && h === 'both') rec.c.ft = e1.notes;

          /* FOLLOW_REPEAT: every stretch of the play order is gated by the app's own function */
          const oracle = runs => runs.every(x => x.ok) ? [].concat(...runs.map(x => lgates(x.from, x.to, h))) : null;
          const O2 = oracle(runsN);
          const G2 = C.gatesOf(PLAN.followGates(r.Np, h, { repeats: true }));
          if (!O2) add('oracleless');
          else {
            const e2 = X.explainGatesExact(O2, G2);
            unexplained('gates ' + at + ' ' + h + ' (repeats)', e2.unexplained);
          }
          if (J(G2) !== J(Lg)) add('rangesRepeat');
          if (r === whole && h === 'both') rec.c.fr = G2.length - Lg.length;

          /* both, and on the plan with jumps and graces too */
          const O3 = oracle(runsA);
          if (O3) {
            const G3 = C.gatesOf(PLAN.followGates(r.Na, h, { repeats: true, ties: true }));
            const d3 = [].concat(...runsA.map(x => dangling(r.Lp.cont, x.from, x.to, h)));
            const e3 = X.explainGatesTies(O3, G3, d3);
            unexplained('gates ' + at + ' ' + h + ' (repeats and ties, every fix on)', e3.unexplained);
          }
        }
      }
    } catch (e) {
      rec.error = String(e && (e.code || e.message) || e).slice(0, 160);
    }
    return rec;
  }

  const out = [];
  try {
    for (const item of items) out.push(await oneFile(item));
  } finally {
    PS.of = origOf;
  }
  return out;
}

/* ---- in the page: the real scheduler on spies. Self-contained. ---- */
async function spiesInPage(items, opts) {
  const C = window.PPPPracticeCanon, PPP = window.PPP, Score = PPP.Score, PS = PPP.PianoScore, PLAN = window.PPPPractice.plan, app = PPP.app;
  const J = JSON.stringify;
  const origOf = PS.of;
  let override = null;
  PS.of = function (sc, f, t) {
    if (override) { const p = override(sc, f, t); if (p) return p; }
    return origOf.call(this, sc, f, t);
  };
  const round = x => Math.round(x * 1e4) / 1e4;

  function runCase(score, g, c, useNew) {
    const S = app.state;
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
    const key = c.range.from + ':' + c.range.to;
    try {
      const scale8 = (score.tempo || 84) * 8;
      Object.assign(S, { score: score, tempo: scale8, loop: !!c.loop, loopFrom: c.range.from, loopTo: c.range.to, beat: 0, playing: false, hands: c.hands,
        practiceMode: 'practice', screen: 'practice', metro: true, toggles: Object.assign({}, S.toggles, { notes: true, follow: false, midiOut: false, midi: false, sound: true }) });
      app._piano = fakePiano;
      app._tp = null;
      if (c.mode === 'midi') { app.midiOutLive = () => true; app.midiOutLayer = () => fakeOut; }
      override = useNew ? (sc, f, t) => {
        if (f + ':' + t !== key) throw new Error('the scheduler asked for a range that was not planned: ' + f + ':' + t);
        return c.plan;
      } : null;
      app.startTransport(S, Score.startQ(score, c.range.from));
      const tp = app._tp;
      tp.t0 = T0; tp.schedT = T0;
      const plan = tp.plan;
      const ahead = Math.max(PPP.PIANO.lookaheadMs, c.mode === 'midi' ? 1600 : 0);
      const lap = PS.msAt(plan, plan.soundLengthQ, tp.scale);
      const end = T0 + lap * (c.loop ? 2.2 : 1) + 2 * ahead;
      for (let now = T0 - 50; now < end; now += ahead / 2) app.schedule(now, S);
    } finally {
      override = null;
      delete app.midiOutLive; delete app.midiOutLayer;
      app._piano = savedPiano; app._tp = savedTp;
      Object.assign(S, saved);
    }
    log.notes.forEach(n => { delete n.open; });
    return log;
  }

  const out = [];
  try {
    for (const item of items) {
      const rec = { file: item.file, runs: 0, events: 0, fail: [] };
      try {
        let xml = item.text;
        if (xml == null) {
          const res = await fetch('/' + item.file);
          xml = /\.mxl$/.test(item.file) ? await PPP.readMxl(await res.arrayBuffer()) : await res.text();
        }
        const score = PPP.scoreFromXml(xml, item.file.split('/').pop());
        const src = window.PPPEngrave.app.resolveSync(score);
        if (!src || src.via !== 'live') throw new Error('no live graph');
        const g = src.graph;
        const mk = r => PLAN.build(g, { range: { from: Score.measure(score, r.from).index, to: Score.measure(score, r.to).index }, defaultQpm: score.tempo });
        const whole = { from: Score.first(score), to: Score.last(score) };
        const wins = C.windows(score, 20, C.cyrb64(item.file)[1]);
        const cases = [];
        ['audio', 'midi'].forEach(mode => ['both', 'right', 'left'].forEach(h => cases.push({ mode: mode, hands: h, loop: false, range: whole })));
        if (wins[0]) cases.push({ mode: 'midi', hands: 'both', loop: true, range: wins[0] });
        if (wins[1]) cases.push({ mode: 'audio', hands: 'right', loop: true, range: wins[1] });
        for (const c of cases) {
          c.plan = mk(c.range);
          const a = runCase(score, g, c, false), b = runCase(score, g, c, true);
          rec.runs++;
          const n = a.notes.length + a.ccs.length + a.clicks.length;
          rec.events += n;
          if (J(a) !== J(b)) rec.fail.push(c.mode + ' ' + c.hands + (c.loop ? ' loop' : '') + ' [' + c.range.from + '..' + c.range.to + ']: the queued ' + (J(a.notes) !== J(b.notes) ? 'notes' : J(a.ccs) !== J(b.ccs) ? 'controller events' : 'clicks') + ' differ');
          else if (c.hands === 'both' && (!a.notes.length || !a.clicks.length)) rec.fail.push(c.mode + ' both: the spy heard nothing (notes, controller events, clicks: ' + J([a.notes.length, a.ccs.length, a.clicks.length]) + ')');
        }
      } catch (e) {
        rec.fail.push('error: ' + String(e && e.message || e).slice(0, 140));
      }
      out.push(rec);
    }
  } finally {
    PS.of = origOf;
  }
  return out;
}

/* ---- running ---- */
async function openParityApp(url, planSource) {
  const app = await L.openApp(url);
  await app.page.addScriptTag({ content: fs.readFileSync(CORE_SRC, 'utf8') });
  await app.page.addScriptTag({ content: planSource });
  const ok = await app.page.evaluate(() => !!(window.PPPPractice && window.PPPPractice.plan && window.PPPParity && window.PPPEngraveModules && window.PPPEngraveModules.source));
  if (!ok) { await app.close(); throw new Error('the page lacks practice/plan.js, parity-core.js or the engrave source module'); }
  return app;
}

async function runAll(page, list, opts, spyList, onBatch) {
  const recs = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const part = await page.evaluate(parityInPage, list.slice(i, i + BATCH).map(c => ({ file: c.path, text: c.text })), opts);
    part.forEach(r => recs.push(r));
    if (onBatch) onBatch(recs.length, list.length);
  }
  const spies = [];
  for (let i = 0; i < spyList.length; i += 3) {
    const part = await page.evaluate(spiesInPage, spyList.slice(i, i + 3).map(c => ({ file: c.path, text: c.text })), opts);
    part.forEach(r => spies.push(r));
  }
  return { recs, spies };
}

/* ---- the report and the baseline ---- */
const CKEYS = ['jf', 'jv', 'js', 'jt', 'ge', 'gs', 'gm', 'gc', 'fr', 'ft'];
const SUMKEYS = ['ranges', 'strikes', 'ids', 'helpers', 'begin', 'matcher', 'gates', 'matcherFix', 'rangesJump', 'rangesGrace', 'rangesRepeat', 'rangesTie', 'oracleless'];

function totalsOf(recs) {
  const ok = recs.filter(r => !r.error && !r.fb);
  const t = { files: recs.length, refused: recs.filter(r => r.error).length, fallback: recs.filter(r => r.fb).length };
  SUMKEYS.forEach(k => { t[k] = ok.reduce((a, r) => a + (r.k[k] || 0), 0); });
  t.causes = {
    JUMP: { files: ok.filter(r => r.c.jf).length, visits: ok.reduce((a, r) => a + (r.c.jv || 0), 0), strikes: ok.reduce((a, r) => a + (r.c.js || 0), 0),
      silentTies: ok.reduce((a, r) => a + (r.c.jt || 0), 0) },
    GRACE: { files: ok.filter(r => r.c.gs).length, events: ok.reduce((a, r) => a + (r.c.ge || 0), 0), strikes: ok.reduce((a, r) => a + (r.c.gs || 0), 0),
      moved: ok.reduce((a, r) => a + (r.c.gm || 0), 0), cut: ok.reduce((a, r) => a + (r.c.gc || 0), 0) },
    FOLLOW_REPEAT: { files: ok.filter(r => r.c.fr).length, gates: ok.reduce((a, r) => a + (r.c.fr || 0), 0) },
    FOLLOW_TIE: { files: ok.filter(r => r.c.ft).length, notes: ok.reduce((a, r) => a + (r.c.ft || 0), 0) }
  };
  return t;
}
const lotDigest = recs => Canon.digest(recs.map(r => JSON.stringify([r.error || '', r.fb || '', CKEYS.map(k => r.c[k] || 0), SUMKEYS.map(k => r.k[k] || 0)])).join('|'));

function fileEntry(r) {
  if (r.error) return { x: r.error };
  if (r.fb) return { fb: r.fb };
  const o = {};
  CKEYS.forEach(k => { if (r.c[k]) o[k] = r.c[k]; });
  return o;
}

function assemble(recs, spies, corp, opts) {
  const by = new Map(corp.map(c => [c.path, c]));
  const open = recs.filter(r => !by.get(r.file).quarantined), shut = recs.filter(r => by.get(r.file).quarantined);
  const sets = {};
  [...new Set(corp.map(c => c.set))].forEach(set => { sets[set] = totalsOf(open.filter(r => by.get(r.file).set === set)); });
  const quarantined = totalsOf(shut);
  quarantined.digest = lotDigest(shut);
  const files = {};
  open.forEach(r => { const e = fileEntry(r); if (Object.keys(e).length) files[r.file] = e; });
  return {
    schema: 1,
    about: 'G11a-2 event-parity harness (tests/practice/parity.js): per set the sums of what was compared and the counts per cause (JUMP, GRACE, FOLLOW_REPEAT, FOLLOW_TIE) of practice/plan.js against the legacy player; per file only the files a cause acts on. Rewritten by `node tests/practice/parity.js record`; read the diff.',
    options: { windows: opts.windows, hands: ['both', 'right', 'left'], tempi: [1, 0.5], streams: Canon.STREAMS, spyFiles: SPY_FILES },
    sets: sets,
    quarantined: quarantined,
    spies: { files: spies.length, runs: spies.reduce((a, s) => a + s.runs, 0), events: spies.reduce((a, s) => a + s.events, 0) },
    files: files
  };
}

/* hard failures (whatever the baseline says), then differences from the baseline */
function verdict(recs, spies, corp, base, full) {
  const by = new Map(corp.map(c => [c.path, c]));
  const hard = [], drift = [];
  let nShut = 0, shutFail = 0, shutUn = 0;
  recs.forEach(r => {
    const c = by.get(r.file);
    const named = c.quarantined ? 'a licence-quarantined file' : r.file;
    if (c.quarantined) { nShut++; if (r.nfail) shutFail++; if (r.nun) shutUn++; }
    else {
      r.fail.forEach(m => hard.push('DIFFERENCE ' + r.file + ': ' + m));
      if (r.nfail > r.fail.length) hard.push(r.file + ': ... and ' + (r.nfail - r.fail.length) + ' more difference(s)');
      r.un.forEach(m => hard.push('UNEXPLAINED ' + r.file + ': ' + m));
      if (r.nun > r.un.length) hard.push(r.file + ': ... and ' + (r.nun - r.un.length) + ' more unexplained');
    }
    if (r.error && (!base || !base.files[r.file] || base.files[r.file].x !== r.error) && !c.quarantined) hard.push(named + ': refused (' + r.error + ')' + (base && base.files[r.file] && base.files[r.file].x ? ', the baseline expected: ' + base.files[r.file].x : ' - the baseline expects it to open'));
    if (r.error && c.quarantined && c.set === 'catalog') hard.push('a licence-quarantined file was refused');
    if (r.fb && c.set !== 'scoregraph-xml') hard.push(named + ': the graph is not the live one (' + r.fb + '): the graph plan would fall back to the legacy plan');
  });
  if (shutFail) hard.push(shutFail + ' of ' + nShut + ' licence-quarantined files differ from the legacy plan (not named; run `node tests/practice/record.js dump` locally on the catalogue to see)');
  if (shutUn) hard.push(shutUn + ' of ' + nShut + ' licence-quarantined files have differences no cause explains (not named)');
  spies.forEach(s => s.fail.forEach(m => hard.push('SCHEDULER ' + s.file + ': ' + m)));
  if (base) {
    recs.forEach(r => {
      const c = by.get(r.file);
      if (c.quarantined) return;
      const want = base.files[r.file];
      if (r.error || r.fb) { if (!want) drift.push(r.file + ': not in the baseline as refused'); return; }
      if (want && (want.x || want.fb)) { drift.push(r.file + ': was refused in the baseline, now read'); return; }
      const got = fileEntry(r), w = want || {};
      const keys = new Set([...Object.keys(got), ...Object.keys(w)]);
      const diffs = [...keys].filter(k => (got[k] || 0) !== (w[k] || 0)).map(k => k + ' ' + (w[k] || 0) + ' -> ' + (got[k] || 0));
      if (diffs.length) drift.push(r.file + ': ' + diffs.join(', '));
    });
    if (full) {
      const have = new Set(recs.map(r => r.file));
      Object.keys(base.files).forEach(f => { if (!have.has(f)) drift.push(f + ': in the baseline but not in the corpus (run `record`)'); });
      const cur = assemble(recs, spies, corp, { windows: base.options.windows });
      ['sets', 'quarantined', 'spies'].forEach(part => { if (JSON.stringify(cur[part]) !== JSON.stringify(base[part])) drift.push('the ' + part + ' totals differ from the baseline: ' + diffKeys(base[part], cur[part])); });
    }
  }
  return { hard, drift };
}
function diffKeys(a, b, prefix) {
  const out = [];
  const walk = (x, y, p) => {
    if (x && y && typeof x === 'object' && typeof y === 'object') new Set([...Object.keys(x), ...Object.keys(y)]).forEach(k => walk(x[k], y[k], p + '.' + k));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p.slice(1) + ' ' + JSON.stringify(x) + ' -> ' + JSON.stringify(y));
  };
  walk(a, b, prefix || '');
  return out.slice(0, 6).join('; ') + (out.length > 6 ? '; ... ' + (out.length - 6) + ' more' : '');
}

function writeBaseline(b) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  const head = JSON.stringify(Object.assign({}, b, { files: undefined }), null, 1).replace(/\n}$/, '');
  const body = Object.keys(b.files).map(f => ' ' + JSON.stringify(f) + ': ' + JSON.stringify(b.files[f])).join(',\n');
  fs.writeFileSync(BASELINE, head + ',\n"files": {\n' + body + '\n}\n}\n');
}

/* the files a check runs. full: all; sample N: every Nth catalogue file + every fixture + every file the baseline gives a cause; shard K/M: every Mth file */
function select(corp, args, base) {
  let list = corp;
  if (args.sample) {
    const always = new Set(base ? Object.keys(base.files).filter(f => { const e = base.files[f]; return !e.x && !e.fb && (e.jf || e.gs || e.ft); }) : []);
    SPY_FILES.forEach(f => always.add(f));
    let n = -1;
    list = corp.filter(c => {
      if (c.set !== 'catalog') return true;
      n++;
      return n % args.sample === 0 || always.has(c.path);
    });
  }
  if (args.shard) list = list.filter((c, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) list = list.filter(c => c.path.indexOf(args.only) >= 0);
  return list;
}

/* the whole job, reusable (the mutation check calls it): { recs, spies, secs } */
async function runParity(o) {
  const t0 = Date.now();
  let srv = null, url = o.url;
  if (!url) { srv = await L.serve(); url = srv.url; }
  const app = await openParityApp(url, o.planSource || fs.readFileSync(PLAN_SRC, 'utf8'));
  try {
    const spyList = o.spies === false ? [] : o.list.filter(c => SPY_FILES.indexOf(c.path) >= 0);
    const r = await runAll(app.page, o.list, { windows: o.windows }, spyList, o.onBatch);
    if (app.problems.length) r.problems = app.problems.slice(0, 5);
    r.secs = (Date.now() - t0) / 1000;
    return r;
  } finally {
    await app.close();
    if (srv) await srv.close();
  }
}

function parseArgs(argv) {
  const a = { cmd: argv[0], sample: 0, shard: null, only: null, windows: DEFAULTS.windows, spies: true, url: null, out: OUT, planSrc: null, rest: [] };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sample') a.sample = +argv[++i];
    else if (k === '--shard') { const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || ''); if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error('--shard K/M'); a.shard = [+m[1], +m[2]]; }
    else if (k === '--only') a.only = argv[++i];
    else if (k === '--windows') a.windows = +argv[++i];
    else if (k === '--no-spies') a.spies = false;
    else if (k === '--url') a.url = argv[++i];
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--plan-src') a.planSrc = path.resolve(argv[++i]);
    else if (k.startsWith('--')) throw new Error('unknown argument ' + k);
    else a.rest.push(k);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corp = corpus();
  if (args.cmd === 'record' || args.cmd === 'check') {
    let base = null;
    if (args.cmd === 'check') { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); args.windows = base.options.windows; }
    else if (args.sample || args.shard || args.only) throw new Error('record takes the whole corpus: a baseline of some files would be wrong');
    const list = select(corp, args, base);
    if (!list.length) throw new Error('no file selected');
    const full = list.length === corp.length;
    const t0 = Date.now();
    const { recs, spies, secs, problems } = await runParity({
      corp: corp, list: list, windows: args.windows, spies: args.spies, url: args.url, planSource: args.planSrc ? fs.readFileSync(args.planSrc, 'utf8') : null,
      onBatch: (done, all) => { if (done === all || done % 80 < BATCH) process.stdout.write('  ' + done + '/' + all + ' files, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s\n'); }
    });
    const by = new Map(corp.map(c => [c.path, c]));
    const summary = assemble(recs, spies, corp, args);
    const report = Object.assign({}, summary);
    report.mode = args.sample ? 'sample ' + args.sample : args.shard ? 'shard ' + args.shard.join('/') : args.only ? 'only ' + args.only : 'full';
    report.seconds = secs;
    report.detail = {};
    recs.filter(r => !by.get(r.file).quarantined).forEach(r => { report.detail[r.file] = { k: r.k, c: r.c, fail: r.fail, un: r.un, error: r.error, fb: r.fb }; });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(report, null, 1));
    if (args.cmd === 'record') {
      const v = verdict(recs, spies, corp, null, true);
      if (v.hard.length) { v.hard.slice(0, 30).forEach(m => console.log('  ' + m)); throw new Error(v.hard.length + ' problem(s); nothing written'); }
      writeBaseline(summary);
      console.log('recorded ' + recs.length + ' files in ' + secs.toFixed(1) + ' s -> ' + path.relative(L.ROOT, BASELINE));
      printSummary(report);
      return;
    }
    const v = verdict(recs, spies, corp, base, full);
    printSummary(report, recs.length, secs, args);
    if (problems && problems.length) console.log('page errors: ' + problems.join(' | '));
    if (v.drift.length) { console.log(v.drift.length + ' difference(s) from tests/practice/baselines/parity.json (a change on purpose: `node tests/practice/parity.js record`):'); v.drift.slice(0, 30).forEach(d => console.log('  ' + d)); }
    if (v.hard.length) { console.log(v.hard.length + ' PROBLEM(S):'); v.hard.slice(0, 40).forEach(d => console.log('  ' + d)); if (v.hard.length > 40) console.log('  ... and ' + (v.hard.length - 40) + ' more'); }
    if (v.hard.length || v.drift.length) process.exit(1);
    console.log('parity: compat mode equals the legacy player everywhere; every fix difference is explained by its cause; scheduler spies equal');
    return;
  }
  if (args.cmd === 'show') {
    const f = args.rest[0];
    const c = corp.find(x => x.path === f);
    if (!c) throw new Error('not a corpus path: ' + f);
    if (c.quarantined) throw new Error('that file is licence-quarantined: no per-file output');
    const { recs } = await runParity({ corp: corp, list: [c], windows: args.windows, spies: false, url: args.url });
    console.log(JSON.stringify(recs[0], null, 1));
    return;
  }
  console.log('usage: node tests/practice/parity.js check [--sample N] [--shard K/M] [--only SUBSTR] [--no-spies] | record | show PATH');
  process.exit(2);
}

function printSummary(report, nFiles, secs, args) {
  const line = (name, t) => console.log('  ' + name.padEnd(18) + String(t.files).padStart(4) + ' files' + String(t.ranges).padStart(7) + ' ranges' + String(t.strikes).padStart(8) + ' strikes' +
    String(t.begin).padStart(7) + ' begin' + String(t.matcher).padStart(7) + ' matcher' + String(t.gates).padStart(7) + ' gates' + (t.refused ? '  ' + t.refused + ' refused' : ''));
  console.log('parity' + (nFiles ? ': ' + nFiles + ' files in ' + secs.toFixed(1) + ' s' + (args && args.sample ? ' (sample ' + args.sample + ')' : args && args.shard ? ' (shard ' + args.shard.join('/') + ')' : '') : ''));
  Object.keys(report.sets).forEach(k => line(k, report.sets[k]));
  line('quarantined', report.quarantined);
  const all = { JUMP: { files: 0, visits: 0, strikes: 0, silentTies: 0 }, GRACE: { files: 0, events: 0, strikes: 0, moved: 0, cut: 0 }, FOLLOW_REPEAT: { files: 0, gates: 0 }, FOLLOW_TIE: { files: 0, notes: 0 } };
  [...Object.values(report.sets), report.quarantined].forEach(t => CAUSES.forEach(c => Object.keys(all[c]).forEach(f => { all[c][f] += t.causes[c][f]; })));
  CAUSES.forEach(c => console.log('  ' + c.padEnd(14) + JSON.stringify(all[c])));
  console.log('  scheduler spies: ' + report.spies.files + ' files, ' + report.spies.runs + ' runs, ' + report.spies.events + ' queued events');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { corpus, runParity, select, verdict, assemble, totalsOf, SPY_FILES, BASELINE, PLAN_SRC, openParityApp, parityInPage, spiesInPage };
