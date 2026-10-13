/* G11b-0: the eight pieces of the simulator (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4: "2 per method book, 1 hymn,
   1 recording arrangement"), and what the simulator reads from each.

   Split, fixed before any legacy run was looked at:
     tune     beyer 050, czerny599 010, burgmuller25 001, hymn amazing-grace     - the learner model's one calibration
                                                                                     (the G6-to-log-odds map below) was
                                                                                     set on these four only
     holdout  beyer 060, czerny599 050, burgmuller25 002, the recording piece     - never used to set anything
   G11b-2 tunes its policy on `tune` (and on learner seeds below 100) and reports `holdout`.

   Each piece is what the app holds after an import: the ScoreGraph -> scoregraph/legacy-score.js toScore -> the
   app's own Score.finalize (from the vm, tests/practice-sim/app-legacy.js), the app's scoreFromXml path with
   PPP.fingering at its default. The per-measure, per-hand difficulty `d` is G6's (difficulty/: featuresOf, then
   the committed weights' measureMap, the hotspot map of PPP.difficulty='g6'): the local score of the measure, and
   the hand split G6 itself reports.

   The recording piece is tests/practice-sim/fixtures/rec-g01-leadsheet.sg.json: the G0 golden transcription G01
   (a recording PPP converted: tests/scoregraph/golden/G01.sg.json) arranged by the app's own one-note glue
   (tests/realize/app-single-extract.js) from its lead sheet (recordingArrange 'leadsheet', G10c-1a) at
   'intermediate'. It is a frozen input: `node tests/practice-sim/pieces.js --make-rec` rewrites it and
   `--check-rec` says whether today's arranger still makes the same bytes (local, not in the gate: an arranger
   change must not move the simulator's baseline). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const R = p => require(path.join(REPO, p));
const SG = R('scoregraph/index.js');
const DF = R('difficulty/index.js');
const WEIGHTS = R('difficulty/weights/g6a-v1.json');
const REC_FIXTURE = path.join(__dirname, 'fixtures', 'rec-g01-leadsheet.sg.json');

const PIECES = [
  { id: 'beyer-050', file: 'catalog/method/beyer/050.mxl', family: 'beyer', split: 'tune' },
  { id: 'beyer-060', file: 'catalog/method/beyer/060.mxl', family: 'beyer', split: 'holdout' },
  { id: 'czerny599-010', file: 'catalog/method/czerny599/010.mxl', family: 'czerny599', split: 'tune' },
  { id: 'czerny599-050', file: 'catalog/method/czerny599/050.mxl', family: 'czerny599', split: 'holdout' },
  { id: 'burgmuller-001', file: 'catalog/method/burgmuller25/001.mxl', family: 'burgmuller25', split: 'tune' },
  { id: 'burgmuller-002', file: 'catalog/method/burgmuller25/002.mxl', family: 'burgmuller25', split: 'holdout' },
  { id: 'hymn-amazing-grace', file: 'catalog/hymns/amazing-grace.musicxml', family: 'hymn', split: 'tune' },
  { id: 'rec-g01-leadsheet', file: 'tests/practice-sim/fixtures/rec-g01-leadsheet.sg.json', family: 'recording', split: 'holdout' }
];

/* The one calibration (on the `tune` pieces only): G6's local measure score (a weighted sum of z-scores; -2.6 .. +2.7 on
   the eight pieces) to a difficulty in log-odds, d = 1.6 + 0.5 * score, kept in [0.4, 3.5], so that the `even` learner's
   first full-tempo reading of the tune pieces lands at 45-65 % of the notes (a plausible first reading for a pupil the
   piece suits) and the beginner's at 20-40 %. Measured over 50 learners a type (note-weighted, day 0, score tempo):
   tune even 0.65, beginner 0.32; hold-out (not looked at to set it) even 0.59, beginner 0.27. A hand's share: the hand
   G6 names as the hotspot's carries the whole d, the other 0.6 .. 1 of it by G6's own hand shares. */
const D_BASE = 1.6, D_SLOPE = 0.5, D_MIN = 0.4, D_MAX = 3.5;

/* A piece's bytes as git stores them: a text file (MusicXML, a graph) with its line ends made LF, so a Windows checkout
   (core.autocrlf) and a Linux one read the same input; .mxl is binary. */
function pieceBytes(file) {
  const buf = fs.readFileSync(path.join(REPO, file));
  return /\.mxl$/i.test(file) ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

async function graphOf(piece) {
  const abs = path.join(REPO, piece.file);
  const bytes = pieceBytes(piece.file);
  if (abs.endsWith('.sg.json')) return SG.parse(bytes.toString('utf8'));
  const r = await SG.importFile(new Uint8Array(bytes), { name: path.basename(abs), scoreId: 'sim-' + piece.id });
  if (!r.ok) throw new Error('pieces: ' + piece.file + ' does not import: ' + (r.message || r.code));
  return r.graph;
}

function handShares(fm) {
  /* G6's own hand split of one measure (difficulty/model.js measureMap): positive weighted z-contributions per hand */
  const W = WEIGHTS;
  const share = { RH: 0, LH: 0 };
  ['RH', 'LH'].forEach(h => W.featureNames.forEach((name, i) => {
    const v = fm.hand && fm.hand[h] ? fm.hand[h][name] : undefined;
    if (v == null || !(W.std[i] > 0)) return;
    const c = W.weights[i] * (v - W.mean[i]) / W.std[i];
    if (c > 0) share[h] += c;
  }));
  return share;
}

/* { id, split, family, title, score (the app's Score), graph, measures: [{ index, number, d: {r, l}, notes: {r, l}, lenQ }] } */
async function load(piece, E) {
  const graph = await graphOf(piece);
  const score = E.Score.finalize(SG.legacy.toScore(graph, { name: piece.id }));
  score.id = 'sim:' + piece.id;
  const feats = DF.features.featuresOf(graph);
  const map = DF.model.measureMap(feats, WEIGHTS);
  if (map.length !== score.measures.length) throw new Error('pieces: ' + piece.id + ': G6 has ' + map.length + ' measures, the Score ' + score.measures.length);
  const one = E.PianoScore.of(score, score.measures[0].number, score.measures[score.measures.length - 1].number);
  const notes = score.measures.map(() => ({ r: 0, l: 0 }));
  const idxOf = {};
  score.measures.forEach((mm, i) => { idxOf[mm.number] = i; });
  /* one written pass of every measure: the notes a hand strikes in it (repeats are visits, counted by the runner) */
  const seen = new Set();
  one.strikes.forEach(s => {
    if (s.hand !== 'r' && s.hand !== 'l') return;
    if (seen.has(s.note)) return;
    seen.add(s.note);
    notes[idxOf[s.m]][s.hand]++;
  });
  const measures = score.measures.map((mm, i) => {
    const fm = feats.measures[i];
    const sc = map[i].score;
    const d = Math.min(D_MAX, Math.max(D_MIN, D_BASE + D_SLOPE * sc));
    const sh = handShares(fm);
    const top = Math.max(sh.RH, sh.LH);
    const part = h => (top > 0 ? 0.6 + 0.4 * (sh[h] / top) : 1);
    return { index: i, number: mm.number, lenQ: mm.lenQ, g6: Math.round(sc * 1e6) / 1e6, d: { r: d * part('RH'), l: d * part('LH') }, notes: notes[i] };
  });
  return { id: piece.id, split: piece.split, family: piece.family, file: piece.file, title: score.title, score, graph, measures };
}

async function loadAll(E, ids) {
  const out = [];
  for (const p of PIECES) if (!ids || ids.indexOf(p.id) >= 0) out.push(await load(p, E));
  return out;
}

/* ---- the recording piece's fixture (local tool; see the header) ---- */
async function makeRec() {
  const X = R('tests/realize/app-single-extract.js');
  const ref = X.reference();
  const app = X.make({ window: X.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });
  const g = SG.parse(fs.readFileSync(path.join(REPO, 'tests/scoregraph/golden/G01.sg.json'), 'utf8'));
  const r = await app.arrangeSingleNote(g, { level: 'intermediate', recordingArrange: 'leadsheet' });
  if (!r || !r.ok) throw new Error('pieces: the lead sheet arrangement of G01 was refused: ' + (r && r.reason));
  return SG.serialize(r.graph) + '\n';
}

if (require.main === module) {
  (async () => {
    if (process.argv.includes('--make-rec')) {
      fs.mkdirSync(path.dirname(REC_FIXTURE), { recursive: true });
      fs.writeFileSync(REC_FIXTURE, await makeRec());
      console.log('wrote', path.relative(REPO, REC_FIXTURE));
    } else if (process.argv.includes('--check-rec')) {
      const same = (await makeRec()) === fs.readFileSync(REC_FIXTURE, 'utf8').replace(/\r\n/g, '\n');
      console.log(same ? 'the recording piece is what the arranger makes today' : 'the arranger now makes a different recording piece (the fixture is frozen; this is information)');
    } else {
      const E = require('./app-legacy.js').build().E;
      for (const p of await loadAll(E)) {
        const ds = p.measures.map(m => Math.max(m.d.r, m.d.l));
        console.log(p.id, p.split, 'measures', p.measures.length, 'tempo', p.score.tempo, 'sections', p.score.sections.length,
          'd', Math.min(...ds).toFixed(2) + '..' + Math.max(...ds).toFixed(2));
      }
    }
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { PIECES, load, loadAll, graphOf, pieceBytes, makeRec, REC_FIXTURE, D_BASE, D_SLOPE, D_MIN, D_MAX };
