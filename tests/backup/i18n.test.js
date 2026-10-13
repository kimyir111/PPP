'use strict';
/* G13-6: every sentence of Settings > My data (the tx() literals of the page between the "my data" banner and resetProgress()) has a ko, ja and zh translation that keeps
   its {{placeholders}} and is written in that language (the English source is the key, so en needs no entry: i18n/en-US.json is empty by design). tests/i18n/gaps.js
   says a string is missing; this says a translation that exists still carries the number, the file name and the date that the sentence is about. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const CAT = {};
['ko-KR', 'ja-JP', 'zh-CN'].forEach(l => { CAT[l] = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', l + '.json'), 'utf8')).content; });

const from = APP.indexOf('/* ============================ my data: back up, restore, delete everything (G13-6)');
const to = APP.indexOf('  resetProgress() {', from);
const unescape = s => s.replace(/\\(['"`\\])/g, '$1');
const literals = [];
if (from >= 0 && to > from) {
  const rx = /\btx\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*[,)]/g;
  let m;
  const region = APP.slice(from, to);
  while ((m = rx.exec(region))) literals.push(unescape(m[2]));
}
const holes = s => (s.match(/\{\{\w+\}\}/g) || []).sort().join(' ');
const SCRIPT = { 'ko-KR': /[가-힣]/, 'ja-JP': /[぀-ヿ一-鿿]/, 'zh-CN': /[一-鿿]/ };

test('the My data section has its sentences, and there are many of them', () => {
  assert.ok(from > 0 && to > from, 'the banner or resetProgress() moved: this test cannot find the section');
  assert.ok(new Set(literals).size >= 40, 'only ' + new Set(literals).size + ' tx() sentences found');
});

for (const loc of Object.keys(CAT)) {
  test(loc + ': every sentence is translated, in that language, with the same placeholders', () => {
    const bad = [];
    for (const s of new Set(literals)) {
      const t = CAT[loc][s];
      if (typeof t !== 'string' || !t.trim()) { bad.push('missing: ' + s.slice(0, 70)); continue; }
      if (!SCRIPT[loc].test(t)) bad.push('not in ' + loc + ': ' + s.slice(0, 70));
      if (holes(t) !== holes(s)) bad.push('placeholders differ (' + holes(s) + ' vs ' + holes(t) + '): ' + s.slice(0, 70));
    }
    assert.deepEqual(bad, []);
  });
}

test('the typed word of the second question is a word in every language and not the English one', () => {
  for (const loc of Object.keys(CAT)) {
    assert.ok(CAT[loc]['delete'] && CAT[loc]['delete'] !== 'delete', loc);
    assert.ok(CAT[loc]['delete'].length <= 4, loc);
  }
});
