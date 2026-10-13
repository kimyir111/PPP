/* Mutation check of the G10a-1b terms of the time skeleton (docs/GOALS/G10_AUDIO_TO_SCORE.md section 28): the beat cap, the swung
   frames, the convention preference and the committed values of all three. Each planted defect is made in a copy of rec/ (outside
   the repository) and must make a cover-shaped case of covers-fixtures.js, or one of its structural checks (the swung readings'
   phases, the swung window, the convention preference, the committed configuration), fail; the copy without a defect must pass
   them all. The benchmark's rec-mutation-v2 suite cannot see these terms: its
   performances are short (no reading reaches the cap) and straight (no swing).
   node --test tests/rec/skeleton-covers-mutation.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FX = require('./covers-fixtures.js');
const PX = require('./phase-fixtures.js');

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
  /* a defect in the committed values: the skeleton's weights file rewritten */
  if (mutation && mutation.weights) {
    const wf = path.join(dir, 'weights', 'ai5a-v1.json'), W = JSON.parse(fs.readFileSync(wf, 'utf8'));
    mutation.weights(W);
    fs.writeFileSync(wf, JSON.stringify(W, null, 1) + '\n');
  }
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
    find: 'if (Math.round(phi * model.R) % model.R === o) list.push(', replace: 'if (o === 0) list.push(' },
  { id: 'SWUNG-WINDOW-NARROW', why: 'a swung frame looks for the written slot no farther than a straight one', file: 'model.js',
    find: 'rs = Math.min(12, Math.ceil(r * 1.5));', replace: 'rs = r;' },
  { id: 'NO-CONVENTION-PRIOR', why: 'the 2/4 : 4/4 preference is not applied (a 4/4 cover read as 2/4 at the same pulse)', file: 'metre.js',
    find: '      if (conv) sc[i] += conv[H.list[i].mi];', replace: '' },
  { id: 'CONVENTION-PRIOR-WITH-DOWNBEATS', why: 'the preference also overrides heard downbeats', file: 'metre.js',
    find: 'const conv = !opts.downbeats && W.conventionPrior ?', replace: 'const conv = W.conventionPrior ?' },
  /* G10a-1d (G10 section 36): the phase step and the helper's beats */
  { id: 'NO-PHASE-STEP', why: 'the phase step does not run (the first onset decides beat 1 again)', file: 'metre.js',
    find: ' && opts.phaseStep !== false) {', replace: ' && opts.phaseStep !== false && false) {' },
  { id: 'NO-HARMONIC-RHYTHM', why: 'the harmonic rhythm says nothing', file: 'model.js',
    find: '    if (n < 2) return 0;', replace: '    return 0;' },
  { id: 'PHASE-STEP-OTHER-METRE', why: 'the phase step may move to another metre (the group is every reading of the pulse frame)', file: 'metre.js',
    find: 'if (h.fr === b.fr && h.mi === b.mi) g.push(i);', replace: 'if (h.fr === b.fr) g.push(i);' },
  { id: 'PHASE-DOWNBEATS-UNWIRED', why: 'a real tracker\'s downbeats do not reach the phase step', file: 'index.js',
    find: 'phaseDownbeats: phaseOk(W) && downs && helper ? downs : null,', replace: 'phaseDownbeats: null,' },
  { id: 'REAL-BEATS-USED', why: 'a real tracker\'s steady beats reach the metre model (regular half-bar downbeats make 4/4 into 2/4)', file: 'index.js',
    find: '    if (!trusted || !gateOk(g)) return \'phase\';', replace: '    if (!gateOk(g)) return \'phase\';' },
  { id: 'CONFIDENCE-AFTER-MOVE', why: 'the confidence is of the moved phase, not of the metre choice', file: 'metre.js',
    find: '    const r0 = H.list[bi0];', replace: '    const r0 = H.list[bi];' },
  { id: 'NO-HELPER-GATE', why: 'unsteady helper downbeats choose the metre again', file: 'index.js',
    find: '    if (downs && downs.length - 1 >= g.minDownbeats && beats.steadyShare(downs) < g.minSteady) return \'phase\';', replace: '' },
  { id: 'NO-EXTRA-BEAT-GATE', why: 'an audio beat track with beats too many is one pulse', file: 'beats.js',
    find: '      if (opts.maxExtra != null && extra > opts.maxExtra * (out.length - 1)) return null;', replace: '' },
  { id: 'BEAT-CAP-30', why: 'the committed cap is not the one the trainer chose (30 instead of 100)', weights: W => { W.beatCap = 30; } },
  { id: 'SWING-POINT-0.58', why: 'the committed swing point is not the one the trainer chose (0.58 instead of 0.64)', weights: W => { W.swing = [0.58]; } }
];

function run(dir) {
  const REC = require(path.join(dir, 'index.js'));
  return FX.check(REC).concat([FX.phaseCheck(REC), FX.windowCheck(REC), FX.priorCheck(REC), FX.configCheck(REC)], PX.checks(REC));
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
