/* TD15 (second instance) - audio-score.js arrangeNotes() had the same fill-loop bug as the in-page ScoreArranger: a
   same-attack group with more notes than the level's cap but fewer distinct pitches (a unison across voices) never
   ended, because `used` counted pitches and `g.length` counted notes. Each case runs in a worker thread with a hard
   time cap, so a regression fails this test instead of hanging the suite. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CAP_MS = 10000;

if (!isMainThread) {
  const A = require(path.join(__dirname, '..', '..', 'audio-score.js'));
  const notes = workerData.midis.map(m => ({ on: 0, off: 1, midi: m, vel: 72 }));
  const out = A.arrangeNotes(notes, { level: workerData.level, style: workerData.style });
  parentPort.postMessage({ midis: out.map(n => n.midi).sort((a, b) => a - b) });
} else {
  const run = (midis, level, style) => new Promise(resolve => {
    const w = new Worker(__filename, { workerData: { midis, level, style } });
    const timer = setTimeout(() => { w.terminate(); resolve({ hung: true }); }, CAP_MS);
    w.once('message', m => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', e => { clearTimeout(timer); resolve({ error: String(e) }); });
  });

  for (const level of ['beginner', 'intermediate', 'advanced', 'original']) {
    for (const style of ['balanced', 'melody', 'accompaniment']) {
      test('TD15: a unison chord (48,48,60,60 at one attack) terminates at ' + level + '/' + style, async () => {
        const r = await run([48, 48, 60, 60], level, style);
        assert.ok(!r.hung, 'arrangeNotes did not finish within ' + CAP_MS + ' ms (fill loop)');
        assert.ok(!r.error, r.error);
        assert.deepEqual([...new Set(r.midis)], [...new Set(r.midis)].filter(m => m === 48 || m === 60), 'only pitches that were played');
        assert.ok(r.midis.includes(48) && r.midis.includes(60), 'both distinct pitches are kept');
      });
    }
  }
}
