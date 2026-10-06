/* The ?v= tags of the scripts the page loads, and the library version (G10a-6 review, MINOR).
   The server caches static files for an hour, so a changed script that keeps its ?v= is not fetched again by a browser that has it; and audio-score.js refuses a
   scoregraph library of another version ("reload the page"). G10a-6 changed audio-score.js (the hook), scoregraph/legacy-score.js (agree() reads the octave lines
   as a set) and so the library's behaviour: each tag went up by one from main's (audio-score.js 13, legacy-score.js 9, index.js 9) and the library 1.3.1 became 1.3.2.
   Numbers only go up, so this pins a floor, not a value: a later change raises it and never trips it; a revert of this phase's bump does. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const page = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const tag = file => {
  const m = new RegExp('<script src="\\./' + file.replace(/[.\/]/g, '\\$&') + '\\?v=(\\d+)"></script>').exec(page);
  assert.ok(m, file + ' is a script of the page');
  return +m[1];
};
const semver = v => v.split('.').map(Number);
const atLeast = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return true; };

test('the page asks for audio-score.js, legacy-score.js and the library index at a ?v= above main\'s (13, 9, 9)', () => {
  assert.ok(tag('audio-score.js') >= 14, 'audio-score.js ?v=' + tag('audio-score.js'));
  assert.ok(tag('scoregraph/legacy-score.js') >= 10, 'legacy-score.js ?v=' + tag('scoregraph/legacy-score.js'));
  assert.ok(tag('scoregraph/index.js') >= 10, 'scoregraph/index.js ?v=' + tag('scoregraph/index.js'));
});

test('the library version is above main\'s 1.3.1, and audio-score.js asks for the same one', () => {
  const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
  assert.ok(atLeast(SG.version, '1.3.2'), 'scoregraph version ' + SG.version);
  const asked = /const SCOREGRAPH_VERSION = '([\d.]+)';/.exec(fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8'));
  assert.ok(asked, 'audio-score.js names the library version it needs');
  assert.equal(asked[1], SG.version, 'audio-score.js would refuse the library ("reload the page")');
});
