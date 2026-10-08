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
  ['A5', 'a run without a keyboard is counted as measured', [{ file: APP, from: "function runSource(S, result) { return !result ? 'simulated' :", to: "function runSource(S, result) { return !result ? 'measured' :" }], ['kinds']],
  ['A6', 'a Follow lap is counted as measured', [{ file: APP, from: "result.follow ? 'follow' :", to: "false ? 'follow' :" }], ['kinds']],
  ['A7', 'a recall is counted as measured', [{ file: APP, from: "S.practiceMode === 'memory' ? 'memory' : 'measured'; }", to: "'measured'; }" }], ['kinds']],
  ['A8', 'demoRuns=separate does not keep Demo Input out of the history', [{ file: APP, from: 'if (!demoApart) patch.history = Learning.record(S.history, measured, meta);', to: 'patch.history = Learning.record(S.history, measured, meta);' }], ['demo']],
  ['A9', 'U4 is decided for the user: Demo Input is kept out of the history by default', [{ file: APP, from: "const demoApart = kind === 'simulated' && DEMO_RUNS_MODE === 'separate';", to: "const demoApart = kind === 'simulated';" }], ['demo', 'identity']],
  ['A10', 'demoRuns=separate acts under legacy', [{ file: APP, from: "const demoApart = kind === 'simulated' && DEMO_RUNS_MODE === 'separate';", to: "const demoApart = (kind === 'simulated' || (!kind && !result)) && DEMO_RUNS_MODE === 'separate';" }], ['demo', 'identity']],
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
  ['M5', 'a database that never answers holds the log up for ever (neither the open nor the call has a time limit)', [{ file: MOD, from: 'const t = setTimeout(() => { settled = true; const e = new Error(\'timeout\'); e.code = \'timeout\'; reject(e); }, openTimeout);', to: 'const t = null;' }, { file: MOD, from: 'const t = setTimeout(() => { const e = new Error(\'timeout\'); e.code = \'timeout\'; reject(e); }, ms);', to: 'const t = null;' }], ['failures']]
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
