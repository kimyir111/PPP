/* G13-7a: mutation check of the release script, its issue reporter and the server's counters. Each mutant is a copy of the file with ONE rule broken; the test that is
   meant to guard that rule must then FAIL (exit code not 0). A mutant the test lets through means the test does not guard the rule.

     node tests/release/mutants.js

   Also run with no mutation first: the unbroken copy must pass, or a "failing" mutant proves nothing. A mutation whose text is not found exactly once in the file is an
   error (a refactor of the file must not turn a mutant into a no-op without anybody noticing). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const RELEASE = 'tools/release/release.js', ISSUE = 'tools/release/smoke-issue.js', STATS = 'server-stats.js';

const MUTANTS = [
  /* the gate */
  { name: 'the gate check removed (a red gate no longer refuses)', file: RELEASE, find: 'if (!gate.ok) throw new Refusal(gate.why);', put: '/* mutant */', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a missing gate counts as passed', file: RELEASE, find: "if (!runs.length) return { ok: false,", put: "if (!runs.length) return { ok: true,", test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a pending gate counts as passed', file: RELEASE, find: "if (run.status !== 'completed') return { ok: false,", put: "if (false) return { ok: false,", test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a red gate counts as passed', file: RELEASE, find: "if (run.conclusion !== 'success') return { ok: false,", put: "if (false) return { ok: false,", test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'the oldest gate run decides, not the newest', file: RELEASE, find: 'Number(b.id) > Number(a.id) ? b : a', put: 'Number(b.id) > Number(a.id) ? a : b', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'any check run counts as the gate (the name is not compared)', file: RELEASE, find: 'r && r.name === GATE_CHECK', put: 'r', test: 'release', env: 'PPP_RELEASE_MODULE' },
  /* the manual act */
  { name: 'deploys without --confirm', file: RELEASE, find: 'if (!o.confirm) {', put: 'if (false) {', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'deploys from CI', file: RELEASE, find: 'if (o.confirm && (io.env.CI || io.env.GITHUB_ACTIONS))', put: 'if (false)', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a sha of one character is accepted', file: RELEASE, find: '/^[0-9a-f]{7,40}$/i.test(o.sha)', put: '/^[0-9a-f]{1,40}$/i.test(o.sha)', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'the short sha is sent to Render, not the 40 characters', file: RELEASE, find: "'--commit', target.sha, '--confirm']", put: "'--commit', o.sha, '--confirm']", test: 'release', env: 'PPP_RELEASE_MODULE' },
  /* behind the deploy */
  { name: 'a failed smoke check still exits 0', file: RELEASE, find: 'if (res.code !== 0) {', put: 'if (false) {', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'the rollback command is not printed after a failed smoke check', file: RELEASE, find: "'). The release is live. Roll back with:\\n  ' + deployCommand(o, rollbackSha)", put: "'). The release is live.'", test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'the row is added at the bottom of the table, not the top', file: RELEASE, find: 'lines.splice(h + 2, 0, row);', put: 'lines.splice(h + 5, 0, row);', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a row with a missing column is written', file: RELEASE, find: 'if (cells(lines[h]) !== cells(row)) return null;', put: '', test: 'release', env: 'PPP_RELEASE_MODULE' },
  { name: 'a deploy that Render says failed is waited for until the timeout', file: RELEASE, find: 'if (d && BAD_DEPLOY.test(String(d.status)))', put: 'if (false)', test: 'release', env: 'PPP_RELEASE_MODULE' },
  /* the daily smoke's report */
  { name: 'the reporter always opens a new issue (never comments)', file: ISSUE, find: 'if (same) {', put: 'if (false) {', test: 'release', env: 'PPP_SMOKE_ISSUE_MODULE' },
  { name: 'the reporter puts the whole output in the issue', file: ISSUE, find: '.slice(-TAIL_LINES)', put: '', test: 'release', env: 'PPP_SMOKE_ISSUE_MODULE' },
  /* the server's counters */
  { name: 'a 5xx answer is not counted', file: STATS, find: "if (res.statusCode >= 500) c.by[cls]['5xx']++;", put: 'void 0;', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'a 4xx answer is counted as a 5xx', file: STATS, find: 'res.statusCode >= 500', put: 'res.statusCode >= 400', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'a store error is not counted', file: STATS, find: "c.by[ctx && ctx.open ? ctx.cls : 'other'].storeErrors++;", put: 'void 0;', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'every request counts under static (no route classes)', file: STATS, find: 'c.by[cls].requests++;', put: 'c.by.static.requests++;', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'the counters are not reset after a line', file: STATS, find: 'c = fresh(); windowAt = t;', put: 'windowAt = t;', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'the hourly timer keeps the process alive (no unref)', file: STATS, find: 'timer.unref();', put: '', test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'the line carries the request path (a leak)', file: STATS, find: "      by: c.by\n    };", put: "      by: c.by, lastPath: String(lastUrl)\n    };", extra: [{ find: 'const cls = classify(req && req.url);', put: 'const cls = classify(req && req.url); lastUrl = req && req.url;' }, { find: 'let termHooked = false;', put: 'let termHooked = false; let lastUrl = "";' }], test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'SIGTERM does not print the last line', file: STATS, find: "try { flush(true); } catch (e) { /* none */ }\n    try { process.stdout.write", put: "try { process.stdout.write", test: 'stats', env: 'PPP_STATS_MODULE' },
  { name: 'SIGTERM prints the line and never stops the process', file: STATS, find: "try { process.kill(process.pid, 'SIGTERM'); } catch (e) { process.exit(143); }", put: 'void 0;', test: 'stats', env: 'PPP_STATS_MODULE' }
];

const TESTS = {
  release: { cmd: [path.join(REPO, 'tests', 'release', 'release.test.js')] },
  stats: { cmd: [path.join(REPO, 'tests', 'server-stats.test.js'), '--unit'] }
};

function run(test, envName, modulePath) {
  const env = Object.assign({}, process.env);
  delete env.PPP_RELEASE_MODULE; delete env.PPP_SMOKE_ISSUE_MODULE; delete env.PPP_STATS_MODULE;
  if (envName) env[envName] = modulePath;
  return new Promise(resolve => {
    const child = spawn(process.execPath, TESTS[test].cmd, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('exit', code => { clearTimeout(timer); resolve({ code: code === null ? 1 : code, out }); });
  });
}

/* at most 4 at a time: the tests include child processes with timers, which a starved machine would stretch */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-mutants-'));
let bad = 0;
const say = (ok, text) => { console.log((ok ? '  ✓ ' : '  ✗ ') + text); if (!ok) bad++; };
const failing = out => out.split('\n').filter(l => l.includes('✗'));

(async () => {
  console.log('the unbroken files pass their tests');
  const base = await Promise.all(Object.keys(TESTS).map(t => run(t)));
  Object.keys(TESTS).forEach((t, i) => say(base[i].code === 0, t + " test on the repository's files: exit " + base[i].code + (base[i].code === 0 ? '' : '\n' + failing(base[i].out).join('\n'))));

  console.log('\nthe mutants must each fail their test');
  const results = await pool(MUTANTS, 4, async (m, n) => {
    let text = fs.readFileSync(path.join(REPO, m.file), 'utf8').replace(/\r\n/g, '\n');
    for (const step of [{ find: m.find, put: m.put }].concat(m.extra || [])) {
      if (text.split(step.find).length !== 2) return { stale: true };
      text = text.replace(step.find, () => step.put);
    }
    const file = path.join(tmp, n + '-' + path.basename(m.file));
    fs.writeFileSync(file, text);
    return run(m.test, m.env, file);
  });
  MUTANTS.forEach((m, i) => {
    const r = results[i];
    if (r.stale) return say(false, m.name + ': the text to break is not in ' + m.file + ' exactly once (the mutant is stale)');
    say(r.code !== 0, m.name + ' -> ' + (r.code !== 0 ? 'caught (' + (failing(r.out)[0] || 'exit ' + r.code).trim().slice(0, 90) + ')' : 'NOT CAUGHT: the test passed'));
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  if (bad) { console.error('\n' + bad + ' problem(s)'); process.exit(1); }
  console.log('\nall ' + MUTANTS.length + ' mutants were caught');
})().catch(e => { console.error('mutants crashed:', e && e.stack || e); process.exit(2); });
