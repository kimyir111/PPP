/* TD15 - the legacy in-page ScoreArranger's 'balanced' style used to loop forever in selectVoices() when a
   same-attack group held more notes than the level's cap but fewer distinct pitches than notes (a unison across
   voices, e.g. C4 in both soprano and alto, C3 in both tenor and bass: 4 notes, 2 pitches, cap 3). `used` counted
   pitches, `g.length` counted notes, so the fill loop never saw "nothing left to take". Each case runs in a worker
   thread with a hard time cap, so a regression fails this test instead of hanging the suite. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CAP_MS = 15000;

if (!isMainThread) {
  (async () => {
    const { SG, graphOf } = require('./helpers.js');
    const { scoreArranger } = require('./score-arranger-extract.js');
    const g = await graphOf(workerData.rel);
    const score = SG.legacy.toScore(g, { name: 'td15', id: 'td15', ids: true });
    const t = Date.now();
    const out = scoreArranger().arrange(score, { level: workerData.level, style: workerData.style });
    parentPort.postMessage({ ms: Date.now() - t, notes: out.notes.map(n => ({ m: n.m, b: n.b, midi: n.midi, staff: n.staff })) });
  })().catch(e => parentPort.postMessage({ error: String(e && e.stack || e) }));
} else {
  const run = (rel, level, style) => new Promise(resolve => {
    const w = new Worker(__filename, { workerData: { rel, level, style } });
    const timer = setTimeout(() => { w.terminate(); resolve({ hung: true }); }, CAP_MS);
    w.once('message', m => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', e => { clearTimeout(timer); resolve({ error: String(e) }); });
  });

  test('TD15: christ-arose at intermediate/balanced terminates', async () => {
    const r = await run('catalog/hymns/christ-arose.musicxml', 'intermediate', 'balanced');
    assert.ok(!r.hung, 'ScoreArranger.arrange did not finish within ' + CAP_MS + ' ms (selectVoices loop)');
    assert.ok(!r.error, r.error);
    assert.ok(r.notes.length > 0);
    /* a unison group keeps one note per distinct pitch, and never more than the level cap (3) */
    const byAttack = new Map();
    r.notes.forEach(n => { const k = n.m + ':' + n.b; byAttack.set(k, (byAttack.get(k) || 0) + 1); });
    assert.ok(Math.max(...byAttack.values()) <= 3 * 2, 'no attack carries more than cap notes per staff');
  });

  for (const rel of ['catalog/hymns/god-rest-ye-merry.musicxml', 'catalog/hymns/hark-the-herald.musicxml',
    'catalog/method/burgmuller25/019.mxl']) {
    for (const level of ['original', 'beginner', 'intermediate', 'advanced']) {
      test('TD15: ' + path.basename(rel) + ' ' + level + '/balanced terminates', async () => {
        const r = await run(rel, level, 'balanced');
        assert.ok(!r.hung, 'ScoreArranger.arrange did not finish within ' + CAP_MS + ' ms');
        assert.ok(!r.error, r.error);
        assert.ok(r.notes.length > 0);
      });
    }
  }
}
