#!/usr/bin/env node
/* ============================================================================
   PPP rec/ (G10a-3, stage S8) - the key and spelling stage on the catalogue truth, in isolation
   (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8.1 and 22)

     python tests/bench/tools/key_data.py          the truth cache (note level: stays in the git-ignored tests/bench/.cache)
     node rec/tools/key-eval.js                    print the evaluation
     node rec/tools/key-eval.js --write            write rec/tools/key-v1.evaluation.json
     node rec/tools/key-eval.js --check            recompute it and compare it byte for byte with the committed file
     node rec/tools/key-eval.js --weights '{"FIT":3}' --list      try other constants, list the pieces that go wrong
     node rec/tools/key-eval.js --grid             the tuning grid over FIT and PRIOR (tuning pieces only)

   What it measures: every trusted reference (the benchmark's own reader: struct.key.fifths_exact's truth, the written
   spelling of every note) played as TRUTH NOTES (the exact onsets, bars, staves and durations of the score), so that the
   stage itself is measured, neither the skeleton nor the writer. Against audio-score.js's estimateKey and spellingTable (the
   legacy stage) and against the stage with its regions and spelling switched off one at a time. The end-to-end effect on
   the benchmark's performances (critical.key, notation.spelling.accuracy, critical.accidentals) is in the rec suites.

   Hold-out references (fnv1a32(id) % 5 == 0) are reported and never used to choose a constant: the constants of rec/key.js
   were fitted on the tuning references only.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const AS = require(path.join(REPO, 'audio-score.js'));
const KEY = require('../key.js');
const TRUTH = path.join(REPO, 'tests', 'bench', '.cache', 'key', 'truth.json');
const EVALUATION = path.join(__dirname, 'key-v1.evaluation.json');
const argv = process.argv.slice(2);
const flag = n => argv.indexOf(n) >= 0;
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const TPQ = 24;

function loadPieces() {
  if (!fs.existsSync(TRUTH)) { process.stderr.write('missing ' + TRUTH + ': run python tests/bench/tools/key_data.py first\n'); process.exit(2); }
  return JSON.parse(fs.readFileSync(TRUTH, 'utf8')).pieces.filter(p => p.trusted);
}

/* a truth piece as the notes the stage receives */
function stageNotes(p) {
  return p.notes.map(n => ({ midi: n[2], tick: Math.round(n[0] * TPQ), endTick: Math.round((n[0] + n[1]) * TPQ), staff: n[3], vel: 64, bar: n[6] }));
}
function legacyNotes(p) { return p.notes.map(n => ({ midi: n[2], on: n[0], off: n[0] + n[1], vel: 64 })); }

function evaluate(pieces, weights, opts) {
  opts = opts || {};
  const agg = () => ({ pieces: 0, keyLegacy: 0, keyV2: 0, notes: 0, spellLegacy: 0, spellV2: 0, spellV2TrueSig: 0, spellLegacyTrueSig: 0, withRegions: 0, withChanges: 0, changesWrong: 0, changesRight: 0 });
  const all = agg();
  const bySet = {};
  const list = [];
  pieces.forEach(p => {
    const set = p.set + (p.holdout ? ':holdout' : '');
    const s = bySet[set] = bySet[set] || agg();
    const f0 = p.bars[0][2];
    const lk = AS._.estimateKey(legacyNotes(p));
    const ltab = AS._.spellingTable(lk);
    const sn = stageNotes(p);
    const bars = p.bars.length;
    const res = KEY.analyse(sn, { bars: bars, ticksPerQuarter: TPQ, barTicks: Math.round(Math.max.apply(null, p.bars.map(b => b[1])) * TPQ), weights: weights, regions: opts.regions !== false });
    let okL = 0, okV = 0;
    p.notes.forEach((n, i) => {
      const a = AS._.spell(n[2], ltab), b = res.spell[i];
      if (a.step === n[4] && a.alter === n[5]) okL++;
      if (b.step === n[4] && b.alter === n[5]) okV++;
    });
    const truthChanges = new Set(p.bars.map(b => b[2])).size > 1;
    [all, s].forEach(a => {
      a.pieces++; a.notes += p.notes.length;
      a.keyLegacy += lk.fifths === f0 ? 1 : 0; a.keyV2 += res.key.fifths === f0 ? 1 : 0;
      a.spellLegacy += okL; a.spellV2 += okV;
      if (res.regions.length > 1) a.withRegions++;
      if (res.changes.length) { a.withChanges++; if (truthChanges) a.changesRight++; else a.changesWrong++; }
    });
    list.push({ id: p.id, hold: p.holdout, f0: f0, legacy: lk.fifths, v2: res.key.fifths, spellLegacy: okL / p.notes.length, spellV2: okV / p.notes.length,
      regions: res.regions.length, changes: res.changes.map(c => c.bar + ':' + c.fifths), truthChanges: truthChanges });
  });
  return { all: all, bySet: bySet, list: list };
}

function fmt(a) {
  const r = (x, n) => (x / n).toFixed(4);
  return 'pieces ' + a.pieces + '  key exact legacy ' + r(a.keyLegacy, a.pieces) + ' v2 ' + r(a.keyV2, a.pieces) +
    '  | spelling (notes ' + a.notes + ') legacy ' + r(a.spellLegacy, a.notes) + ' v2 ' + r(a.spellV2, a.notes) +
    '  | regions>1: ' + a.withRegions + '  signature changes written: ' + a.withChanges + ' (true ' + a.changesRight + ', spurious ' + a.changesWrong + ')';
}

function summary(pieces, weights) {
  const tune = pieces.filter(p => !p.holdout), hold = pieces.filter(p => p.holdout);
  const out = { schema: 'ppp.rec-key-eval/1', stage: 'S8', version: KEY.VERSION, weights: Object.assign({}, KEY.W, weights || {}), sets: {} };
  [['tuning', tune], ['holdout', hold]].forEach(([name, ps]) => {
    const a = evaluate(ps, weights).all;
    const noReg = evaluate(ps, weights, { regions: false }).all;
    const r = x => Math.round(x * 1e4) / 1e4;
    out.sets[name] = { references: a.pieces, notes: a.notes,
      keyExactLegacy: r(a.keyLegacy / a.pieces), keyExactV2: r(a.keyV2 / a.pieces),
      spellingLegacy: r(a.spellLegacy / a.notes), spellingV2: r(a.spellV2 / a.notes), spellingV2NoRegions: r(noReg.spellV2 / noReg.notes),
      withRegions: a.withRegions, signatureChangesWritten: a.withChanges, signatureChangesTrue: a.changesRight, signatureChangesSpurious: a.changesWrong };
  });
  return out;
}

const pieces = loadPieces();
const weights = arg('--weights') ? JSON.parse(arg('--weights')) : undefined;

if (flag('--grid')) {
  const tune = pieces.filter(p => !p.holdout);
  const fits = [1.8, 2.5, 3, 4, 5, 6], priors = [0, 0.04, 0.08, 0.12, 0.2];
  process.stdout.write('tuning pieces ' + tune.length + ': key exact by FIT (rows) and PRIOR (columns)\n        ' + priors.map(x => String(x).padStart(7)).join('') + '\n');
  fits.forEach(fit => {
    process.stdout.write(String(fit).padEnd(8) + priors.map(prior => {
      const a = evaluate(tune, Object.assign({}, weights, { FIT: fit, PRIOR: prior }), { regions: false }).all;
      return (a.keyV2 / a.pieces).toFixed(3).padStart(7);
    }).join('') + '\n');
  });
  process.exit(0);
}

if (flag('--write') || flag('--check')) {
  const text = JSON.stringify(summary(pieces, weights), null, 1) + '\n';
  if (flag('--write')) { fs.writeFileSync(EVALUATION, text); process.stdout.write('wrote ' + path.relative(REPO, EVALUATION) + '\n'); process.exit(0); }
  const have = fs.existsSync(EVALUATION) ? fs.readFileSync(EVALUATION, 'utf8').split('\r\n').join('\n') : '';     /* a Windows checkout has CRLF */
  if (have === text) { process.stdout.write('key evaluation: same\n'); process.exit(0); }
  process.stdout.write('key evaluation: DIFFERENT from ' + path.relative(REPO, EVALUATION) + '\n');
  process.stdout.write(text);
  process.exit(1);
}

const res = evaluate(pieces, weights);
Object.keys(res.bySet).sort().forEach(k => process.stdout.write(k.padEnd(16) + fmt(res.bySet[k]) + '\n'));
process.stdout.write('ALL'.padEnd(16) + fmt(res.all) + '\n');
const tune = evaluate(pieces.filter(p => !p.holdout), weights).all, hold = evaluate(pieces.filter(p => p.holdout), weights).all;
process.stdout.write('tuning'.padEnd(16) + fmt(tune) + '\nhold-out'.padEnd(17) + fmt(hold) + '\n');
if (flag('--list')) {
  process.stdout.write('\nkey wrong (v2):\n');
  res.list.filter(r => r.f0 !== r.v2).forEach(r => process.stdout.write('  ' + r.id + (r.hold ? ' HOLD' : '') + ' true ' + r.f0 + ' v2 ' + r.v2 + ' legacy ' + r.legacy + '\n'));
  process.stdout.write('signature changes written:\n');
  res.list.filter(r => r.changes.length).forEach(r => process.stdout.write('  ' + r.id + ' ' + r.changes.join(' ') + (r.truthChanges ? '  (truth has a change)' : '  SPURIOUS') + '\n'));
  process.stdout.write('pieces with more than one tonal region: ' + res.list.filter(r => r.regions > 1).map(r => r.id + '(' + r.regions + ')').join(' ') + '\n');
}
