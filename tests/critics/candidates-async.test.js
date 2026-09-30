/* G9e-lite: candidates.runAsync (the page's responsive run) equals run(), the thread is handed back between candidates, and
   `skipEngrave` (no layout benchmark in a browser) leaves the default gate untouched. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const CAND = require(path.join(REPO, 'candidates/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const IMPORT = require(path.join(REPO, 'scoregraph/musicxml-import.js'));

function hymn(name) {
  return IMPORT.importMusicXml(fs.readFileSync(path.join(REPO, 'catalog/hymns', name + '.musicxml'), 'utf8'), { scoreId: 'h-' + name }).graph;
}
const summary = r => JSON.stringify({ ok: r.ok, fp: r.selected && r.selected.fingerprint, explanation: r.explanation, tried: r.tried.map(t => [t.ok, t.stage, t.reason]), scored: r.scored.map(c => c.fingerprint) });

test('runAsync gives the same result as run() (default gate and skipEngrave, with single-note hands) and yields between candidates', async () => {
  for (const name of ['christ-arose', 'nearer-my-god']) {
    const g = hymn(name), sg = SGG.analyze(g);
    const request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
    for (const opts of [{}, { singleNoteHands: true }, { singleNoteHands: true, skipEngrave: true }, { fullEngrave: true, n: 4 }]) {
      let ticks = 0;
      const a = CAND.run(g, sg, request, opts);
      const b = await CAND.runAsync(g, sg, request, Object.assign({ yield: () => { ticks++; return Promise.resolve(); } }, opts));
      assert.equal(summary(b), summary(a), name + ' ' + JSON.stringify(opts));
      if (a.ok) assert.ok(ticks >= 2, 'the thread was handed back ' + ticks + ' times');
    }
  }
});

test('runAsync without a yield function still runs, and its cache answers like run()\'s', async () => {
  const g = hymn('pass-me-not'), sg = SGG.analyze(g), request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
  const cache = new Map();
  const a = await CAND.runAsync(g, sg, request, { singleNoteHands: true, skipEngrave: true, cache: cache });
  const b = await CAND.runAsync(g, sg, request, { singleNoteHands: true, skipEngrave: true, cache: cache });
  assert.equal(cache.size, 1);
  assert.equal(b.selected.fingerprint, a.selected.fingerprint);
  const noSkip = await CAND.runAsync(g, sg, request, { singleNoteHands: true, cache: cache });
  assert.equal(cache.size, 2, 'skipEngrave is part of the cache key');
  assert.ok(noSkip.selected.scores.engrave && typeof noSkip.selected.scores.engrave.silent === 'number', 'the default still measures engraving');
});

test('skipEngrave is off by default: a plain run still engrave-checks its top candidates', () => {
  const g = hymn('nearer-my-god'), sg = SGG.analyze(g);
  const r = CAND.run(g, sg, { targetLevel: 2, handProfile: 'large', sections: 'all' }, {});
  assert.ok(r.ok);
  assert.match(r.explanation, /engrave checked for the top/);
  assert.equal(typeof r.selected.scores.engrave.silent, 'number');
});
