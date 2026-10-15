/* G11b-1: mutation checks of PPP.learner and the run log, in the page. One rule of the page or of practice/runlog.js is BROKEN on its way to the
   browser (tests/practice/learner-proxy.js rewrites one line of the served file; no file is touched) and the sections of tests/learner-log.test.js that
   watch that rule must go red. A mutant that survives is a rule nothing watches; a row whose line is no longer in the file is STALE and fails too.
   The control (nothing mutated) must be green.

     node tests/practice/learner-mutants.js               the control, then every row (about 15 minutes)
     node tests/practice/learner-mutants.js A5 M2         only these rows (and the control unless --no-control)
     node tests/practice/learner-mutants.js --list
     node tests/practice/learner-mutants.js --upstream http://127.0.0.1:9210     use that server of this tree (default: one on a free port)

   Needs puppeteer. LL_PORT_RANGE="9220-9249" keeps the proxy's port in a range. The rules of practice/runlog.js that need no browser are broken by
   tests/practice/runlog-mutation.test.js. */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { fileProxy } = require('./learner-proxy');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = 'Piano Coach App.dc.html', MOD = 'practice/runlog.js';
const WITH_PORT = path.join(ROOT, 'tests', 'engrave', 'tools', 'with-port.js');

/* id, what the mutant breaks, [{file, from, to}] (each `from` is in its file exactly once), and the sections of tests/learner-log.test.js that must notice */
const ROWS = [
  ['A1', 'the default is typed, not legacy', [{ file: APP, from: "const LEARNER_DEFAULT = 'legacy';", to: "const LEARNER_DEFAULT = 'typed';" }], ['switch']],
  ['A2', 'practice/runlog.js is requested under legacy too', [{ file: APP, from: "\nif (LEARNER_MODE === 'typed') loadRunLogModule();\n", to: '\nloadRunLogModule();\n' }], ['switch', 'identity']],
  ['A3', 'a legacy page names its runs (the kind of run reaches Learning.record under legacy)', [{ file: APP, from: "const kind = LEARNER_MODE === 'typed' ? runSource(S, result) : null;", to: 'const kind = runSource(S, result);' }], ['identity']],
  ['A4', 'a legacy run summary gets a source key of its own', [{ file: APP, from: 'if (meta.source !== undefined) summary.source = meta.source;', to: "summary.source = meta.source || 'legacy';" }], ['identity']],
  ['A5', 'a run without a keyboard is counted as measured (under demoRuns count, the opt-out: the only path that still names it)', [{ file: APP, from: "  if (!result) return 'simulated';", to: "  if (!result) return 'measured';" }], ['demo']],
  ['A6', 'a Follow lap is counted as measured', [{ file: APP, from: "  if (result.follow) return 'follow';", to: "  if (false) return 'follow';" }], ['kinds']],
  ['A7', 'a recall is counted as measured', [{ file: APP, from: "  return S.practiceMode === 'memory' ? 'memory' : 'measured';", to: "  return 'measured';" }], ['kinds']],
  ['A8', 'a run without a keyboard is counted again: the demo branch of completeLap is never taken (U4 undone)', [{ file: APP, from: "if (!result && DEMO_RUNS_MODE === 'separate') {", to: "if (false && !result && DEMO_RUNS_MODE === 'separate') {" }], ['demo', 'demolive', 'identity', 'kinds']],
  ['A9', 'U4 is not the default again: the default of PPP.demoRuns is count', [{ file: APP, from: "const DEMO_RUNS_DEFAULT = 'separate';", to: "const DEMO_RUNS_DEFAULT = 'count';" }], ['switch', 'demo', 'identity']],
  ['A10', 'U4 holds under typed only: a legacy page still counts a run without a keyboard', [{ file: APP, from: "if (!result && DEMO_RUNS_MODE === 'separate') {", to: "if (!result && LEARNER_MODE === 'typed' && DEMO_RUNS_MODE === 'separate') {" }], ['demo', 'identity']],
  ['A25', 'a recall without a keyboard still moves memory (only a practice lap is kept apart)', [{ file: APP, from: "if (!result && DEMO_RUNS_MODE === 'separate') {", to: "if (!result && DEMO_RUNS_MODE === 'separate' && S.practiceMode !== 'memory') {" }], ['demo', 'identity']],
  ['A26', 'a lap without a keyboard adds minutes, xp and a weekly bar', [{ file: APP, from: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true };", to: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true, minutes: S.minutes + 1, xp: S.xp + 20 };" }], ['demo', 'identity']],
  ['A27', 'a lap without a keyboard raises a section bar (its repetitions)', [{ file: APP, from: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true };", to: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true, secs: Object.keys(S.secs).reduce((o, k) => { o[k] = Object.assign({}, S.secs[k], { reps: S.secs[k].reps + 1 }); return o; }, {}) };" }], ['demo', 'identity']],
  ['A28', 'a lap without a keyboard counts toward the coach task', [{ file: APP, from: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true };", to: "{ const dp = { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true }; this.advanceCoach(S, dp); return dp; }" }], ['demo']],
  ['A29', 'a lap without a keyboard steps the Loop panel (its repetitions)', [{ file: APP, from: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true };", to: "return { laps: S.laps + 1, runHit: 0, runTot: 0, wrongNotes: [], lastDemo: true, seqReps: S.seqReps + 1 };" }], ['demo']],
  ['A30', 'the card says nothing of a run that was not recorded', [{ file: APP, from: 'showDemoNote: demoNote,', to: 'showDemoNote: false,' }], ['demo']],
  ['A31', 'the hint of what to do is told after every practice lap, not once', [{ file: APP, from: "if (!this._demoTold || S.practiceMode === 'memory') {", to: 'if (true) {' }], ['demo']],
  ['A32', 'a lap without a keyboard keeps its last accuracy and drift on the card as if they were its own', [{ file: APP, from: "runDrift: follows || demoNote || !S.lastRec ? '—' :", to: "runDrift: follows ? '—' :" }], ['demo']],
  ['A33', 'a keyboard that goes live after Play is never judged: the lap boundary asks the keyboard it had at the START of the lap', [{ file: APP, from: 'if (this.liveMidi()) this.beginRun(S, patch.beat); else this._sim = this.newSim();', to: 'if (live) this.beginRun(S, patch.beat); else this._sim = this.newSim();' }], ['democonnect']],
  ['A34', 'the line shows during every real lap with a keyboard (the "while it plays" clause forgets the keyboard)', [{ file: APP, from: "const demoNote = demoLast || (DEMO_RUNS_MODE === 'separate' && !midiLive && !!(S.playing && S.screen !== 'score'));", to: "const demoNote = demoLast || (DEMO_RUNS_MODE === 'separate' && !!(S.playing && S.screen !== 'score'));" }], ['democonnect']],
  ['A35', 'the line shows only after a lap, not while a run without a keyboard plays', [{ file: APP, from: "const demoNote = demoLast || (DEMO_RUNS_MODE === 'separate' && !midiLive && !!(S.playing && S.screen !== 'score'));", to: 'const demoNote = demoLast;' }], ['democonnect']],
  ['A36', 'a recorded lap never clears the mark: after a keyboard has come, a recorded run is called unrecorded', [{ file: APP, from: 'lastResult: result || null, lastDemo: false, lastRec: true', to: 'lastResult: result || null, lastRec: true' }], ['democonnect']],
  ['A37', 'with a keyboard connected the line still says there is none (the line is not about the last run)', [{ file: APP, from: "!demoNote ? '' : midiLive ? tx('The last run was played without a keyboard, so it was not recorded. (Demo Input)') :", to: "!demoNote ? '' :" }], ['demo', 'democonnect']],
  ['A38', 'Progress shows the seed (or 0%) as the last run after a run that was not recorded', [{ file: APP, from: "v: S.lastRec ? S.lastAcc + '%' : '—', sub: tx('last run')", to: "v: S.lastAcc + '%', sub: tx('last run')" }], ['democonnect']],
  ['A39', 'Home says "just now" for a lap that was not recorded (it reads the screen lap counter)', [{ file: APP, from: "lastPracticed: S.lastRec ? tx('just now') : tx('12 minutes ago'),", to: "lastPracticed: S.laps ? tx('just now') : tx('12 minutes ago')," }], ['democonnect']],
  ['A40', 'the hint sends a browser without Web MIDI to the Demo Input button', [{ file: APP, from: 'try { web = this.midiLayer().supported(); }', to: 'try { web = true; }' }], ['demo']],
  ['A11', 'a song removed from My Songs leaves its run log behind', [{ file: APP, from: '    forgetRunLog(id);\n', to: '' }], ['log']],
  ['A12', 'the run log is built from the summary and not from the matcher: no signed timing, no missed ids', [{ file: APP, from: 'const fromEngine = kind !== \'follow\' && perf && perf.run', to: 'const fromEngine = false && perf && perf.run' }], ['kinds']],
  ['A13', 'a simulated run is not counted on its epoch', [{ file: APP, from: "if (kind === 'simulated') { log.noteSimulated(key.songId, key.hash, key.meta, key.hashV); this.noteRunLogTime(t0, kind); return; }", to: "if (kind === 'simulated') { this.noteRunLogTime(t0, kind); return; }" }], ['kinds']],
  ['A14', 'the rating row shows while laps are looping', [{ file: APP, from: 'showRunRating: !!(LEARNER_MODE === \'typed\' && S.ratingRun && !S.playing),', to: 'showRunRating: !!(LEARNER_MODE === \'typed\' && S.ratingRun),' }], ['log']],
  ['A15', 'the practice log card shows under legacy', [{ file: APP, from: "showLogSettings: LEARNER_MODE === 'typed',", to: 'showLogSettings: true,' }], ['ui']],
  ['A16', 'a legacy page writes to IndexedDB: the log module is loaded and called whatever the switch says', [{ file: APP, from: "if (kind) this.logRun(S, kind, result, measured, from, to, acc);", to: 'this.logRun(S, kind || runSource(S, result), result, measured, from, to, acc);' }, { file: APP, from: "\nif (LEARNER_MODE === 'typed') loadRunLogModule();\n", to: '\nloadRunLogModule();\n' }], ['identity']],
  ['M1', 'the cap of 300 is gone', [{ file: MOD, from: 'const excess = Math.max(0, info.count + 1 - cap);', to: 'const excess = 0;' }], ['log']],
  ['M2', 'a new music hash does not become the song\'s current epoch in IndexedDB', [{ file: MOD, from: '            ss.put(p.song);\n            set({ n: p.n', to: '            set({ n: p.n' }], ['log']],
  ['M3', 'after a failure the log keeps going to the store', [{ file: MOD, from: "if (degraded) { if (!quiet) stats.skipped++; return { ok: false, code: 'degraded' }; }", to: '' }], ['failures']],
  ['M4', 'a run is written however long it is: no merging, no 2 KB', [{ file: MOD, from: 'if (bytes <= CAPS.body) return { entry: e, bytes: bytes, g: g, ids: withIds };', to: 'return { entry: e, bytes: bytes, g: g, ids: withIds };' }], ['budget']],
  ['M5', 'a database that never answers holds the log up for ever (neither the open nor the call has a time limit)', [{ file: MOD, from: 'const t = setTimeout(() => { settled = true; const e = new Error(\'timeout\'); e.code = \'timeout\'; reject(e); }, openTimeout);', to: 'const t = null;' }, { file: MOD, from: 'const t = setTimeout(() => { const e = new Error(\'timeout\'); e.code = \'timeout\'; reject(e); }, ms);', to: 'const t = null;' }], ['failures']],
  ['A17', 'a lap that ends while the page is being wiped writes to the log (the frozen page is not asked)', [{ file: APP, from: "    if (this._frozen) return;     /* G13-6: a restore or a delete is on its way to a reload: nothing may recreate 'ppp-runlog' now */\n", to: '' }, { file: APP, from: "|| LEARNER_MODE !== 'typed' || this._frozen) return;", to: "|| LEARNER_MODE !== 'typed') return;" }], ['frozen']],
  ['A18', 'a lap with a keyboard and nothing played is counted as measured evidence', [{ file: APP, from: "if (c && c.expected > 0 && !c.matched && !c.wrong && !c.extra) return 'idle';", to: '' }], ['idle']],
  ['A19', 'an idle lap goes down the ordinary path (and is refused by the log as no kind of run) instead of being counted', [{ file: APP, from: "      if (kind === 'idle') { log.noteIdle(key.songId, key.hash, key.meta, key.hashV); this.noteRunLogTime(t0, kind); return; }\n", to: '' }], ['idle']],
  ['A20', 'the memory level of a recall is always 0', [{ file: APP, from: 'level: mem ? (S.memReveal ? 0 : mem.level) : 0,', to: 'level: 0,' }], ['fields']],
  ['A21', 'the hands, the tempo and the score tempo of a lap are constants', [{ file: APP, from: 'hands: S.hands, tempo: S.tempo, scoreTempo: S.score.tempo,\n        from: Math.max(0, info.idxOf(from))', to: "hands: 'both', tempo: 80, scoreTempo: 80,\n        from: Math.max(0, info.idxOf(from))" }], ['fields']],
  ['A22', 'the wrong and the extra keys of a lap are always 0 in the run', [{ file: APP, from: 'wrong: result && result.counts ? result.counts.wrong : 0, extra: result && result.counts ? result.counts.extra : 0,', to: 'wrong: 0, extra: 0,' }], ['fields']],
  ['A23', 'the measures that had wrong or extra keys are not listed', [{ file: APP, from: 'wrongs: L.wrongsFromResult(result, info)', to: 'wrongs: []' }], ['fields']],
  ['A24', 'a Follow lap with the memory tab open is called a recall', [{ file: APP, from: "  if (result.follow) return 'follow';", to: "  if (result.follow && S.practiceMode !== 'memory') return 'follow';" }], ['fields']],
  ['M6', 'a Follow run carries the tempo slider', [{ file: MOD, from: "tp: input.src === 'follow' ? null : isNum(input.tempo)", to: 'tp: isNum(input.tempo)' }, { file: MOD, from: "sr: input.src === 'follow' ? null : input.scoreTempo > 0", to: 'sr: input.scoreTempo > 0' }], ['fields']],
  ['M7', 'the address of the exported file is never given back to the browser', [{ file: MOD, from: 'w.document.body.removeChild(a); w.URL.revokeObjectURL(url);', to: 'w.document.body.removeChild(a);' }], ['log']],
  ['M8', 'a rating is written for a run that is not there (IndexedDB)', [{ file: MOD, from: 'if (!ev.target.result) { set({ ok: false }); return; }', to: '' }], ['log']],
  ['M9', 'the counter of idle laps counts as the counter of laps without a keyboard (IndexedDB)', [{ file: MOD, from: "const f = a.field === 'idle' ? 'idle' : 'sim';", to: "const f = 'sim';" }], ['idle']],
  /* G11b-3: PPP.learner 'adaptive' (the sections of tests/practice/adaptive-sections.js, run from tests/learner-log.test.js) */
  ["B1", "policy bypass: the card is always the legacy recommendation", [{ file: APP, from: "if (this._ad && !this._ad.busy) { const a = this.adaptiveRec(); if (a) return a; }", to: "if (false) { const a = this.adaptiveRec(); if (a) return a; }" }], ['adcard','adlocale']],
  ["B2", "policy bypass: the Loop panel keeps the legacy steps", [{ file: APP, from: "      const steps = this.adaptiveSteps();\n      if (steps) return steps;", to: "      const steps = null;\n      if (steps) return steps;" }], ['adseq']],
  ["B3", "policy bypass: the coach is not told the model's summary or the policy's plan", [{ file: APP, from: "if (ad && !plain) this.adaptiveBlock(ctx);", to: "" }], ['adcard']],
  ["B4", "the model does not learn from a lap (the entry is never folded in)", [{ file: APP, from: "if (!this.adaptiveFold(entry)) return null;", to: "if (false && !this.adaptiveFold(entry)) return null;" }], ['adcard','addemo']],
  ["B5", "no decision after a lap: the card is the one it was before the lap", [{ file: APP, from: "const d = this.adaptiveDecide(S, entry.at);\n      const cur = this.adaptiveCurrent(S), t = d.task;", to: "const d = ad.decision;\n      const cur = this.adaptiveCurrent(S), t = d.task;" }], ['adcard']],
  ["B6", "Demo Input is counted by the model: a lap without a keyboard is fed to it as a measured run", [{ file: APP, from: "if (kind === 'simulated') { log.noteSimulated(key.songId, key.hash, key.meta, key.hashV); this.noteRunLogTime(t0, kind); return; }", to: "if (kind === 'simulated') { log.noteSimulated(key.songId, key.hash, key.meta, key.hashV); if (this._ad) this.adaptiveFeed(S, key, { id: 'mut' + Date.now(), at: Clock.now(), src: 'measured', md: 'practice', hd: 'b', sr: 1, g: 1, R: [[0, 0, 4, 2, 0, 0]], f: 0, t: 0 }); this.noteRunLogTime(t0, kind); return; }" }], ['addemo']],
  ["B7", "validate bypass: the card's task is shown without going through Coach.validate", [{ file: APP, from: "const ok = P.checked({ summary: '', todayGoal: '', tasks: [Object.assign({}, t, { reason: sentence })], coachNote: '', sessionMinutes: 10 }, ctx, Coach.validate);", to: "const ok = { ok: true, plan: { tasks: [Object.assign({}, t, { reason: sentence })] }, issues: [] };" }], ['adfallback']],
  ["B8", "validate bypass: the policy's plan is handed to the coach without going through Coach.validate", [{ file: APP, from: "const ok = P.checked(raw, ctx, Coach.validate);\n    return ok.ok ? ok.plan : null;", to: "return raw;" }], ['adfallback']],
  ["B9", "stale text after a language change: the sentences are cached across languages", [{ file: APP, from: "adaptiveLocale() { return String(this._locale || ''); }", to: "adaptiveLocale() { return ''; }" }, { file: APP, from: "      if (this._ad) this.adaptiveText();   /* G11b-3: the policy's sentences (card, steps, plan) were made by tx() too */\n", to: "" }], ['adlocale']],
  ["B10", "U6 undone: the policy's tempo step is applied between laps whether the switch is on or not", [{ file: APP, from: "if (ad.auto) { patch = { tempo: clamp(R0((S.score.tempo || 84) * t.tempoPercent / 100), 30, 200) }; ad.stats.autoApplied++; }", to: "if (true) { patch = { tempo: clamp(R0((S.score.tempo || 84) * t.tempoPercent / 100), 30, 200) }; ad.stats.autoApplied++; }" }], ['adtempo']],
  ["B11", "the automatic tempo switch is on by default", [{ file: APP, from: "try { auto = localStorage.getItem(ADAPTIVE_AUTO_KEY) === 'on'; } catch (e) { auto = false; }", to: "try { auto = localStorage.getItem(ADAPTIVE_AUTO_KEY) !== 'off'; } catch (e) { auto = true; }" }], ['adtempo']],
  ["B12", "the automatic tempo switch is not remembered", [{ file: APP, from: "try { if (ad.auto) localStorage.setItem(ADAPTIVE_AUTO_KEY, 'on'); else localStorage.removeItem(ADAPTIVE_AUTO_KEY); } catch (e) { /* kept for this visit */ }", to: "" }], ['adtempo']],
  ["B13", "a legacy page asks for the learner and the policy modules", [{ file: APP, from: "\nif (LEARNER_CHOICE === 'adaptive') loadAdaptiveModules();\n", to: "\nloadAdaptiveModules();\n" }], ['adswitch']],
  ["B14", "an edited piece is not a new epoch: the policy's state ignores the music hash", [{ file: APP, from: "function adaptiveEpoch(songId, hash) { return String(songId) + '|' + String(hash); }", to: "function adaptiveEpoch(songId, hash) { return String(songId) + '|'; }" }], ['adpersist']],
  ["B15", "a service is sent the model's summary and the policy's plan", [{ file: APP, from: "        delete sent.adaptive;\n", to: "" }], ['adcard']],
  ["B16", "the LLM coach is the provider under adaptive when a service is reachable", [{ file: APP, from: "    if (this._ad) return Coach.providers.local;   /* G11b-3 (U8): under PPP.learner 'adaptive' the deterministic coach answers */\n", to: "" }], ['adcard']],
  ["B17", "a legacy page builds an adaptive model (the warm-up does not ask which switch is on)", [{ file: APP, from: "    if (LEARNER_CHOICE === 'adaptive') this.adaptiveWarm(this.state);", to: "    this.adaptiveWarm(this.state);" }, { file: APP, from: "if (LEARNER_CHOICE !== 'adaptive' || !S.score) return;\n    const ad = this._ad || (this._ad = this.adaptiveNew());", to: "if (!S.score) return;\n    const ad = this._ad || (this._ad = this.adaptiveNew());" }], ['adswitch']],
  ["B18", "the policy's saved state is never read back: a reload starts the session again", [{ file: APP, from: "ad.state = saved && saved.v === P.VERSION ? saved : P.initState();", to: "ad.state = P.initState();" }], ['adpersist']],
  ["B19", "the model is not rebuilt from the run log: a reload starts with no evidence", [{ file: APP, from: "if (r && r.ok && Array.isArray(r.runs)) runs = r.runs.map(x => x.run).filter(e => e && e.src !== 'simulated');", to: "if (r && r.ok && Array.isArray(r.runs)) runs = [];" }], ['adpersist']]
];

function runSuite(port, sections, upstreamEnv) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { PPP_PORT: String(port), NODE_ENV: 'production' }, upstreamEnv || {});
    delete env.PPP_URL;
    if (sections) env.LL_ONLY = sections.join(','); else delete env.LL_ONLY;
    const child = spawn(process.execPath, ['-r', WITH_PORT, path.join(ROOT, 'tests', 'learner-log.test.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({ code, text }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { ROWS.forEach(r => console.log(r[0] + '  ' + r[1] + '  [' + r[3].join(',') + ']')); return; }
  const ui = argv.indexOf('--upstream');
  const wanted = argv.filter((a, i) => !a.startsWith('--') && !(ui >= 0 && i === ui + 1));
  const rows = wanted.length ? ROWS.filter(r => wanted.includes(r[0])) : ROWS;
  if (wanted.length && rows.length !== wanted.length) throw new Error('unknown row in ' + wanted.join(' '));
  let upstream = ui >= 0 ? argv[ui + 1] : null, closeUp = async () => {};
  if (!upstream) {
    const { startServer } = require('../serve-free');
    const srv = await startServer();
    upstream = new URL(srv.url).origin;
    closeUp = srv.close;
  }
  let bad = 0;
  const report = [];
  try {
    if (!argv.includes('--no-control')) {
      const t0 = Date.now();
      const p = await fileProxy(upstream, {});
      const r = await runSuite(p.port, null);
      await p.close();
      const clean = r.code === 0;
      console.log('control (nothing mutated): ' + (clean ? 'green' : 'NOT GREEN (exit ' + r.code + ')') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
      if (!clean) { bad++; console.log(r.text.split('\n').filter(l => /✗|Error/.test(l)).slice(0, 10).join('\n')); }
    }
    for (const [id, what, edits, sections] of rows) {
      const t1 = Date.now();
      const p = await fileProxy(upstream, { edits });
      const r = await runSuite(p.port, sections);
      const counts = p.counts();
      await p.close();
      if (counts.some(c => c !== 1)) { report.push([id, 'STALE']); bad++; console.log(id + ' STALE: applied ' + JSON.stringify(counts) + ' times - ' + what); continue; }
      const killed = r.code !== 0;
      const failed = r.text.split('\n').filter(l => /^\s*✗/.test(l)).length;
      if (!killed) bad++;
      report.push([id, killed ? 'killed' : 'SURVIVED']);
      console.log(id + ' ' + (killed ? 'killed' : 'SURVIVED') + ' - ' + what + ' - ' + (killed ? failed + ' check(s) red in ' + sections.join('+') : 'sections ' + sections.join('+') + ' stayed green') + ' (' + ((Date.now() - t1) / 1000).toFixed(0) + ' s)');
    }
  } finally {
    await closeUp();
  }
  const killed = report.filter(r => r[1] === 'killed').length;
  console.log('\n' + killed + ' of ' + rows.length + ' mutants killed' + (bad ? ', ' + bad + ' PROBLEM(S)' : ', the control green'));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
