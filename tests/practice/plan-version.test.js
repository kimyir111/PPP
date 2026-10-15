'use strict';
/* G11a-3: the page asks for practice/plan.js as `practice/plan.js?v=<PRACTICE_FILE_V>`. A browser keeps a file under its address, so a plan.js that changed under the same ?v= would be
   run, on some devices, next to a page that expects the new one. This pins the bytes (line ends as LF) of practice/plan.js to the version the page names: change the file and the test
   is red until PRACTICE_FILE_V is raised in Piano Coach App.dc.html and tests/practice/baselines/plan-file.json says so (this test prints the line to write). */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const sha = text => crypto.createHash('sha256').update(text.split('\r\n').join('\n')).digest('hex');
const planSha = sha(fs.readFileSync(path.join(REPO, 'practice', 'plan.js'), 'utf8'));
const page = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const pin = JSON.parse(fs.readFileSync(path.join(__dirname, 'baselines', 'plan-file.json'), 'utf8'));

test('the page names the version of practice/plan.js the repository holds', () => {
  const m = /const PRACTICE_FILE_V = (\d+);/.exec(page);
  assert.ok(m, 'PRACTICE_FILE_V is not in the page');
  assert.ok(/'practice\/plan\.js'/.test(page), 'the page no longer names practice/plan.js');
  const v = +m[1];
  assert.equal(pin.PRACTICE_FILE_V, v, 'tests/practice/baselines/plan-file.json says version ' + pin.PRACTICE_FILE_V + ', the page ' + v);
  assert.equal(planSha, pin.sha256, 'practice/plan.js changed: raise PRACTICE_FILE_V in the page (now ' + v + ') and write {"PRACTICE_FILE_V": ' + (v + 1) + ', "sha256": "' + planSha + '"} to tests/practice/baselines/plan-file.json');
});

/* G11a-5: practice/plan.js is also a deferred group of the head, and the served page names it by its content hash; the ?v= of the source is what the hash replaces, and what a server that does
   not know about hashes (and this test) reads. It is kept equal to PRACTICE_FILE_V, so that the page asks for one version of the file in every way it can ask. */
test('the head names the same version of practice/plan.js in its deferred block', () => {
  const m = /<noscript data-ppp-lazy="practice"[^>]*>\s*<script src="\.\/practice\/plan\.js\?v=(\d+)"><\/script>\s*<\/noscript>/.exec(page);
  assert.ok(m, 'the head has no <noscript data-ppp-lazy="practice"> block naming ./practice/plan.js?v=N');
  assert.equal(+m[1], pin.PRACTICE_FILE_V, 'the head says ?v=' + m[1] + ', PRACTICE_FILE_V is ' + pin.PRACTICE_FILE_V);
});
