'use strict';
/* Regression through the actual upload/review UI, on this checkout's server. */
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const L = require('./recording-v2-lib');
const F = require('./recording-v2-fixtures');

(async () => {
  const srv = await startServer();
  L.setBase(srv.url);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
  try {
    for (const legacy of [true, false]) {
      const p = await L.openPage(browser, { legacy, failWhile: /\/scoregraph\/index\.js\?v=\d+$/ });
      const result = await L.importHeard(p, F.keyChange([[8, 0]], 3, 0.004));
      assert.equal(result.screen, 'review', JSON.stringify(result));
      assert.ok(p.__rec.failed.length > 0, 'initial module download was actually blocked');
      assert.ok(p.__rec.requests.some(u => /scoregraph\/index\.js.*retry=/.test(u)), 'core was reloaded');
      await p.waitForFunction(() => document.querySelector('path.vf-notehead:not(.vf-rest), use.vf-notehead:not(.vf-rest)'), { timeout: 30000 });
      const state = await p.evaluate(() => {
        const s = window.PPP.app.state;
        const graph = window.PPPEngrave.app.resolveSync(s.score).graph;
        return { notes: s.score.notes.length, valid: window.PPPScoreGraph.validate(graph).ok,
          analysis: !!window.PPPSongGraph.analyze(graph).ref };
      });
      assert.ok(state.notes > 0);
      assert.equal(state.valid, true);
      assert.equal(state.analysis, true);
      console.log('PASS failed boot -> recovery -> upload -> review (' + (legacy ? 'classic' : 'v2') + ')');
      await p.close();
    }
    const p = await L.openPage(browser, { legacy: true, failWhile: /\/scoregraph\/index\.js/ });
    const failed = await L.importHeard(p, F.keyChange([[8, 0]], 3, 0.004));
    assert.equal(failed.screen, 'upload');
    assert.ok(JSON.stringify(failed.error).includes('The files needed to write the score could not be loaded.'), JSON.stringify(failed));
    p.__rec.failOn = false;
    const retried = await L.importHeard(p, F.keyChange([[8, 0]], 3, 0.004));
    assert.equal(retried.screen, 'review', JSON.stringify(retried));
    console.log('PASS sustained network failure -> clear error -> retry -> review');
    await p.close();
  } finally { await browser.close(); await srv.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
