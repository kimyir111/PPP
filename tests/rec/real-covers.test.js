/* rec/tools/real-covers.js (G10a-1b, docs/GOALS/G10_AUDIO_TO_SCORE.md section 28): the private real-cover tier refuses paths inside
   the repository, prints ids only, and judges v2 against a person's statement of the metre. A synthetic piece stands in for a real
   one (real heard notes never enter the repository, G10-D15). node --test tests/rec/real-covers.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, march } = require('./helpers.js');
const RC = require(path.join(REPO, 'rec', 'tools', 'real-covers.js'));
const TOOL = path.join(REPO, 'rec', 'tools', 'real-covers.js');

test('paths inside the repository are refused (exit 2), outside are allowed', () => {
  assert.equal(RC.insideRepo(path.join(REPO, 'tests')), true);
  assert.equal(RC.insideRepo(REPO), true);
  assert.equal(RC.insideRepo(os.tmpdir()), false);
  const r = spawnSync(process.execPath, [TOOL, '--heard', path.join(REPO, 'tests', 'rec')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PRIVATE_IN_REPO/);
});

test('repeatedHeard plays the notes k times, each copy one heard span later', () => {
  const h = { notes: [{ on: 1, off: 1.5, midi: 60, vel: 60 }, { on: 2, off: 3, midi: 64, vel: 60 }], duration: 3 };
  const r = RC.repeatedHeard(h, 3);
  assert.equal(r.notes.length, 6);
  assert.equal(r.notes[2].on, 1 + 2.5);
  assert.equal(RC.repeatedHeard(h, 1), h);
});

test('a folder of heard notes and a truth file: ids only on the console, the verdict as the exit code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-real-covers-'));
  try {
    fs.writeFileSync(path.join(dir, 'x1.json'), JSON.stringify({ notes: march(16, 100, { jitter: 0.01, seed: 4 }).notes, duration: 40, engine: 'test' }));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not heard notes');
    fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify({ format: 'ppp-real-truth/1', items: { x1: { metre: '4/4', source: 'test' } } }));
    const ok = spawnSync(process.execPath, [TOOL, '--heard', dir], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^x1 .*v2 4\/4 .*truth 4\/4 -> v2 ok/m);
    assert.match(ok.stdout, /confirmed 1: v2 right 1/);
    fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify({ format: 'ppp-real-truth/1', items: { x1: { metre: '3/4', source: 'test' } } }));
    const wrong = spawnSync(process.execPath, [TOOL, '--heard', dir], { encoding: 'utf8' });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stdout, /v2 WRONG/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
