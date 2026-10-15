'use strict';
/* G11c-1: the page asks for practice/variant.js as `practice/variant.js?v=<VARIANT_FILE_V>` (PPP.variant 'on', when a person asks for an easier passage). A browser keeps a file under its address, so a
   variant.js that changed under the same ?v= would be run, on some devices, next to a page that expects the new one. This pins the bytes (line ends as LF) of practice/variant.js to the version the
   page names: change the file and the test is red until VARIANT_FILE_V is raised in Piano Coach App.dc.html and tests/practice-variant/variant-file.json says so (this test prints the line to
   write). The same rule as tests/practice/plan-version.test.js for practice/plan.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const sha = text => crypto.createHash('sha256').update(text.split('\r\n').join('\n')).digest('hex');
const fileSha = sha(fs.readFileSync(path.join(REPO, 'practice', 'variant.js'), 'utf8'));
const page = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const pin = JSON.parse(fs.readFileSync(path.join(__dirname, 'variant-file.json'), 'utf8'));

test('the page names the version of practice/variant.js the repository holds', () => {
  const m = /const VARIANT_FILE_V = (\d+);/.exec(page);
  assert.ok(m, 'VARIANT_FILE_V is not in the page');
  assert.ok(/const VARIANT_SCRIPT = 'practice\/variant\.js';/.test(page), 'the page no longer names practice/variant.js');
  const v = +m[1];
  assert.equal(pin.VARIANT_FILE_V, v, 'tests/practice-variant/variant-file.json says version ' + pin.VARIANT_FILE_V + ', the page ' + v);
  assert.equal(fileSha, pin.sha256, 'practice/variant.js changed: raise VARIANT_FILE_V in the page (now ' + v + ') and write {"VARIANT_FILE_V": ' + (v + 1) + ', "sha256": "' + fileSha + '"} to tests/practice-variant/variant-file.json');
});

test('the page loads it by that version, after the modules it reads, and nowhere else', () => {
  assert.ok(/'\.\/' \+ VARIANT_SCRIPT \+ '\?v=' \+ VARIANT_FILE_V/.test(page), 'the loader does not ask for practice/variant.js?v=VARIANT_FILE_V');
  const at = page.indexOf('function loadVariantModule()');
  assert.ok(at > 0, 'loadVariantModule is not in the page');
  const body = page.slice(at, page.indexOf('\n}\n', at));
  const order = ['loadScoreModules()', 'notation-check.js', 'VARIANT_SCRIPT'].map(k => body.indexOf(k));
  assert.ok(order.every(i => i > -1) && order[0] < order[1] && order[1] < order[2], 'the score modules, then the notation checker, then practice/variant.js: ' + order.join(','));
  /* the head does not name it: a page with the switch off asks for nothing of it */
  assert.ok(!/<script[^>]*practice\/variant\.js/.test(page.slice(0, page.indexOf('</head>'))), 'practice/variant.js is in the head');
});
