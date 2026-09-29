/* G9c: a packet and its key are never written inside the repository (or any git working tree) - refused before any work. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, ITEMS, CACHE, tmpDir } = require('./helpers.js');
const { buildPacket, planOutputs } = require(path.join(REPO, 'review/build.js'));

const opts = extra => Object.assign({ mode: 'h9', seed: 'guard-seed-1', items: ITEMS.slice(0, 1), cache: CACHE }, extra);

test('--out inside the repository is refused, whether or not the directory exists yet', async () => {
  for (const rel of ['tests/review/out-x', 'review/packet', 'packet-in-root', 'tests/engrave/out/review/deep/er', '.']) {
    const out = path.join(REPO, rel);
    await assert.rejects(buildPacket(opts({ out: out, keyOut: path.join(tmpDir('k'), 'key') })), /inside the repository|inside a git working tree/, rel);
    assert.equal(fs.existsSync(path.join(out, 'manifest.json')), false, rel + ': nothing was written');
  }
});

test('a relative --out that resolves into the repository is refused too', async () => {
  const rel = path.relative(process.cwd(), path.join(REPO, 'tests', 'review', 'rel-out'));
  await assert.rejects(buildPacket(opts({ out: rel, keyOut: path.join(tmpDir('k'), 'key') })), /inside/);
});

test('--key-out inside the repository is refused', async () => {
  await assert.rejects(buildPacket(opts({ out: path.join(tmpDir('o'), 'p'), keyOut: path.join(REPO, 'review', 'key-here') })), /--key-out .* inside/);
});

test('the key directory may not be inside the packet directory, nor the packet inside the key directory', () => {
  const base = tmpDir('nest');
  assert.throws(() => planOutputs(path.join(base, 'p'), path.join(base, 'p', 'key')), /separate/);
  assert.throws(() => planOutputs(path.join(base, 'k', 'p'), path.join(base, 'k')), /separate/);
  assert.doesNotThrow(() => planOutputs(path.join(base, 'p'), path.join(base, 'k')));
});

test('the default key directory is a sibling of --out, outside the repository', () => {
  const base = tmpDir('def');
  const r = planOutputs(path.join(base, 'packet'));
  assert.equal(path.dirname(r.keyDir), path.dirname(r.outDir));
  assert.notEqual(r.keyDir, r.outDir);
});

test('a directory in another git working tree is refused (the check is not only about this checkout)', () => {
  /* the other checkout of this project, if it is here; otherwise a throwaway repository */
  const { spawnSync } = require('child_process');
  const d = tmpDir('other-repo');
  const init = spawnSync('git', ['init', '-q', d]);
  if (init.status !== 0) return; /* no git: the path-based check above is all there is */
  assert.throws(() => planOutputs(path.join(d, 'sub', 'packet'), path.join(tmpDir('k2'), 'key')), /git working tree/);
});

test('a directory under the OS temp dir is accepted', () => {
  assert.doesNotThrow(() => planOutputs(path.join(os.tmpdir(), 'ppp-review-guard-ok', 'p'), path.join(os.tmpdir(), 'ppp-review-guard-ok-key')));
});
