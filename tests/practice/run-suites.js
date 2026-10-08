/* G11a-0: the practice and playback browser suites, run together on a FREE port (CI and a developer's machine alike).

   The eleven suites below open http://127.0.0.1:8777 by name, which on a developer's machine is often another session's server serving another
   tree. This runner serves THIS tree on a port the operating system gives it (tests/serve-free.js: NODE_ENV=production, so nothing spawns on
   8788) and starts each suite with tests/engrave/tools/with-port.js, which rewrites 8777 to that port in puppeteer's goto and in Node's http.

     node tests/practice/run-suites.js                    all eleven, one after the other
     node tests/practice/run-suites.js --only follow,midi
     node tests/practice/run-suites.js --list
     node tests/practice/run-suites.js --shard 2/3        every third suite (the CI jobs that split the list use this)
     node tests/practice/run-suites.js --log-dir DIR      each suite's full output (default tests/practice/out/suites)
     node tests/practice/run-suites.js --port N           use the server already listening on N (the mutation proxy of mutants.js) instead of starting one

   A suite's checks are the lines its own ok() helper prints, starting with a tick or a cross (playback-scheduler: PASS or FAIL). The run is red when a suite exits non-zero, runs
   past its limit, or prints no check at all (a suite that silently did nothing is not a pass). The last lines of a failing suite are printed
   here so the CI log shows why without opening the artifact. Needs puppeteer (npm ci; on a developer's machine NODE_PATH may point at another
   tree's node_modules). */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { startServer } = require('../serve-free');

const ROOT = path.resolve(__dirname, '..', '..');
const WITH_PORT = path.join(ROOT, 'tests', 'engrave', 'tools', 'with-port.js');

/* name, file, minutes before the runner gives up on it, and `min`: about three quarters of the checks the suite printed when the list was
   written (2026-10-08: follow 32, falling-notes 26, memory 36, learning 34, playback-scheduler 9, coach 48, midi 74, interactions 52,
   lessons 130, course 49, alignment 11 = 501). A suite that prints far fewer has stopped testing (a skipped block, a changed output),
   so the runner fails it. Raise `min` when a suite grows. */
const SUITES = [
  { name: 'follow', file: 'follow.test.js', limit: 8, min: 25 },
  { name: 'falling-notes', file: 'falling-notes.test.js', limit: 8, min: 20 },
  { name: 'memory', file: 'memory.test.js', limit: 8, min: 28 },
  { name: 'learning', file: 'learning.test.js', limit: 8, min: 26 },
  { name: 'playback-scheduler', file: 'playback-scheduler.test.js', limit: 5, min: 7 },
  { name: 'coach', file: 'coach.test.js', limit: 8, min: 38 },
  { name: 'midi', file: 'midi.test.js', limit: 10, min: 58 },
  { name: 'interactions', file: 'interactions.test.js', limit: 10, min: 40 },
  { name: 'lessons', file: 'lessons.test.js', limit: 12, min: 100 },
  { name: 'course', file: 'course.test.js', limit: 8, min: 38 },
  { name: 'alignment', file: 'alignment.test.js', limit: 5, min: 8 }
];

const PASS_LINE = /^\s*(✓|PASS) /;
const FAIL_LINE = /^\s*(✗|FAIL) /;

function parseArgs(argv) {
  const a = { only: null, list: false, shard: null, port: null, logDir: path.join(__dirname, 'out', 'suites') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--only') a.only = String(argv[++i] || '').split(',').filter(Boolean);
    else if (k === '--list') a.list = true;
    else if (k === '--shard') { const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || ''); if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error('--shard K/N'); a.shard = [+m[1], +m[2]]; }
    else if (k === '--log-dir') a.logDir = path.resolve(argv[++i]);
    else if (k === '--port') a.port = +argv[++i];
    else throw new Error('unknown argument ' + k);
  }
  return a;
}

function runOne(suite, port, logDir) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const log = path.join(logDir, suite.name + '.log');
    const chunks = [];
    const env = Object.assign({}, process.env, { PPP_PORT: String(port), NODE_ENV: 'production' });
    delete env.PPP_URL;                      // the suites that read it would bypass the port rewrite
    const child = spawn(process.execPath, ['-r', WITH_PORT, path.join(ROOT, 'tests', suite.file)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => chunks.push(d));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, suite.limit * 60000);
    child.on('error', e => { chunks.push(Buffer.from('spawn error: ' + e.message + '\n')); });
    child.on('close', code => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8');
      fs.writeFileSync(log, text);
      const lines = text.split(/\r?\n/);
      const pass = lines.filter(l => PASS_LINE.test(l)).length;
      const fail = lines.filter(l => FAIL_LINE.test(l)).length;
      resolve({ suite, code, timedOut, pass, fail, seconds: (Date.now() - t0) / 1000, lines, log });
    });
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  let list = SUITES;
  if (args.only) {
    const bad = args.only.filter(n => !SUITES.some(s => s.name === n));
    if (bad.length) throw new Error('unknown suite ' + bad.join(', ') + ' (have ' + SUITES.map(s => s.name).join(', ') + ')');
    list = SUITES.filter(s => args.only.indexOf(s.name) >= 0);
  }
  if (args.shard) list = list.filter((s, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.list) { list.forEach(s => console.log(s.name)); return; }
  if (!list.length) throw new Error('no suite selected');
  fs.mkdirSync(args.logDir, { recursive: true });
  const srv = args.port ? { port: args.port, close: async () => {} } : await startServer();
  if (srv.external) { console.log('PPP_URL is set: the suites would not use a free port; unset it'); process.exit(2); }
  console.log(args.port ? 'using the server on port ' + args.port : 'serving this tree on ' + srv.url);
  const results = [];
  try {
    for (const s of list) {
      process.stdout.write(s.name + ' ... ');
      const r = await runOne(s, srv.port, args.logDir);
      results.push(r);
      const bad = r.code !== 0 || r.timedOut || r.fail > 0 || r.pass < s.min;
      console.log((bad ? 'FAILED' : 'ok') + ' (' + r.pass + ' checks, ' + r.seconds.toFixed(0) + ' s)');
      if (bad) {
        const why = r.timedOut ? 'ran past ' + s.limit + ' minutes' : r.code !== 0 ? 'exit code ' + r.code : r.fail ? r.fail + ' check(s) failed' : 'only ' + r.pass + ' checks printed, expected at least ' + s.min;
        console.log('  why: ' + why);
        const failing = r.lines.filter(l => FAIL_LINE.test(l)).slice(0, 12);
        (failing.length ? failing : r.lines.filter(l => l.trim()).slice(-14)).forEach(l => console.log('    ' + l));
      }
    }
  } finally {
    await srv.close();
  }
  console.log('\nsuite'.padEnd(21) + 'checks  failed  seconds  result');
  let red = 0;
  results.forEach(r => {
    const bad = r.code !== 0 || r.timedOut || r.fail > 0 || r.pass < r.suite.min;
    if (bad) red++;
    console.log(r.suite.name.padEnd(20) + String(r.pass).padStart(6) + String(r.fail).padStart(8) + r.seconds.toFixed(0).padStart(9) + '  ' + (bad ? 'RED' : 'green'));
  });
  const total = results.reduce((a, r) => a + r.pass, 0);
  const secs = results.reduce((a, r) => a + r.seconds, 0);
  console.log('\n' + results.length + ' suites, ' + total + ' checks, ' + secs.toFixed(0) + ' s, ' + (red ? red + ' RED' : 'all green'));
  process.exit(red ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
