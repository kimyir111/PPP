'use strict';
/* The G3 jobs cache under concurrency. node --test runs these files in parallel processes, and on a fresh checkout
   several of them generate the same tests/bench/out/g3/jobs-<suite>.jsonl at once (g3-corpus-data.js recorded() ->
   g3-graphs.js jobs() -> tools/g3_jobs.py). A file written in place let a reader take a half-written one for done:
   CI run 36174222416 saw 7 pedalled recording graphs where there are over 20. Here N processes ask for one suite at
   once, in a fresh directory (PPP_G3_JOBS_DIR), round after round: every one of them must get every case. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { REPO } = require('./helpers.js');

const GRAPHS = path.join(__dirname, 'tools', 'g3-graphs.js');
const SUITE = 'golden';
const N = 8;
const ROUNDS = 20;
/* golden: one job per case of the suite file */
const CASES = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'bench', 'suites', 'golden.json'), 'utf8')).cases.length;
const READER = "try { console.log(require(process.argv[1]).jobs(process.argv[2]).length) } catch (e) { console.log('error: ' + String(e.message).split('\\n')[0]) }";

function reader(dir) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', READER, GRAPHS, SUITE], {
      cwd: REPO, env: Object.assign({}, process.env, { PPP_G3_JOBS_DIR: dir }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', code => resolve(out.trim() || 'exit ' + code + ': ' + err.trim().split('\n').pop()));
  });
}
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-g3-jobs-'));

test('jobs(): ' + N + ' processes generating one suite at once on a fresh directory all get every case', async () => {
  assert.ok(CASES > 10, 'the golden suite has its cases');
  const bad = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const dir = fresh();
    try {
      const got = await Promise.all(Array.from({ length: N }, () => reader(dir)));
      if (got.some(g => g !== String(CASES))) bad.push('round ' + round + ': ' + JSON.stringify(got));
      const file = path.join(dir, 'jobs-' + SUITE + '.jsonl');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      assert.equal(JSON.parse(lines[0]).cases, CASES, 'the header');
      assert.equal(lines.length, CASES + 2, 'the header, one line per case and the final newline');
      assert.deepEqual(fs.readdirSync(dir).filter(f => f !== 'jobs-' + SUITE + '.jsonl'), [], 'no temporary file left behind');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(bad, [], 'every reader got all ' + CASES + ' cases');
});

test('jobs(): a short file from an earlier run is made again, not read short', async () => {
  const dir = fresh();
  try {
    const whole = await reader(dir);
    assert.equal(whole, String(CASES));
    const file = path.join(dir, 'jobs-' + SUITE + '.jsonl');
    const full = fs.readFileSync(file, 'utf8');
    const lines = full.split('\n');
    /* the header and the first 5 cases; then the same with the last line cut off halfway */
    fs.writeFileSync(file, lines.slice(0, 6).join('\n') + '\n');
    assert.equal(await reader(dir), String(CASES));
    assert.equal(fs.readFileSync(file, 'utf8'), full, 'the same bytes again');
    fs.writeFileSync(file, full.slice(0, full.length - 40));
    assert.equal(await reader(dir), String(CASES));
    assert.equal(fs.readFileSync(file, 'utf8'), full, 'the same bytes again');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
