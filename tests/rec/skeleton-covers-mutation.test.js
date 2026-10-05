/* Mutation check of the two G10a-1b terms of the time skeleton (docs/GOALS/G10_AUDIO_TO_SCORE.md section 28). Each planted
   defect is made in a copy of rec/ (outside the repository) and must make a cover-shaped case of covers-fixtures.js, or its check
   of the swung readings' phases, fail;
   the copy without a defect must pass them all. The benchmark's rec-mutation-v2 suite cannot see these terms: its
   performances are short (no reading reaches the cap) and straight (no swing).
   node --test tests/rec/skeleton-covers-mutation.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FX = require('./covers-fixtures.js');

const REC_DIR = path.join(FX.REPO, 'rec');
const FILES = ['attacks.js', 'beats.js', 'model.js', 'metre.js', 'hands.js', 'index.js'];

/* a copy of rec/ (the stage files S0-S2 need and the weights) with one edit; the edit's text must be found exactly once */
function copyWith(mutation) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-rec-mut-'));
  fs.mkdirSync(path.join(dir, 'weights'));
  FILES.forEach(f => {
    let src = fs.readFileSync(path.join(REC_DIR, f), 'utf8');
    if (mutation && mutation.file === f) {
      const n = src.split(mutation.find).length - 1;
      if (n !== 1) throw new Error('mutation anchor found ' + n + ' times in rec/' + f + ': ' + mutation.find);
      src = src.replace(mutation.find, mutation.replace);
    }
    fs.writeFileSync(path.join(dir, f), src);
  });
  fs.readdirSync(path.join(REC_DIR, 'weights')).forEach(f => fs.copyFileSync(path.join(REC_DIR, 'weights', f), path.join(dir, 'weights', f)));
  return dir;
}

const MUTATIONS = [
  { id: 'NO-BEAT-CAP', why: 'the per-beat evidence grows with the beats again (a long piece is read in 3/8 or 6/8)', file: 'model.js',
    find: 'kb = Math.pow(cap > 0 && nb > cap ? cap : nb, aB) / nb;', replace: 'kb = Math.pow(nb, aB) / nb;' },
  { id: 'NO-SWUNG-FRAMES', why: 'no swung reading is proposed (a swung piece is read compound at 1.5 times its tempo)', file: 'metre.js',
    find: 'const swings = opts.swing || [];', replace: 'const swings = [];' },
  { id: 'SWING-NOT-HEARD', why: 'a swung frame judges its slots where they would be straight', file: 'model.js',
    find: 'const d = (g[i] - (swing ? swingHeard(c, swing.s, swing.o) : c)) * w[i] / sigma;', replace: 'const d = (g[i] - c) * w[i] / sigma;' },
  { id: 'SWING-PHASE-IGNORED', why: 'a reading whose bar phase is an odd eighth takes the frame whose quarters start on the beat', file: 'metre.js',
    find: 'if (Math.round(phi * model.R) % model.R === o) list.push(', replace: 'if (o === 0) list.push(' }
];

function run(dir) {
  const REC = require(path.join(dir, 'index.js'));
  return FX.check(REC).concat([FX.phaseCheck(REC)]);
}

test('the copy of rec/ without a defect passes every cover-shaped case', () => {
  const dir = copyWith(null);
  try {
    const r = run(dir);
    r.forEach(x => assert.ok(x.ok, x.name + ': ' + x.got + ' (want ' + x.want + ')'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

MUTATIONS.forEach(m => test('planted defect ' + m.id + ' (' + m.why + ') is caught', () => {
  const dir = copyWith(m);
  try {
    const r = run(dir);
    const failed = r.filter(x => !x.ok);
    assert.ok(failed.length > 0, m.id + ' was not caught: every case still passes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));
