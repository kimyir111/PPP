#!/usr/bin/env node
/* G6a dataset: every registered method-book piece, its G6 features, its ordinal labels and the app's own legacy
   difficulty numbers for it (docs/GOALS/G06_DIFFICULTY.md §3(b), §4).

     node difficulty/tools/build-dataset.js           rebuild difficulty/tools/dataset/method-books.json
     node difficulty/tools/build-dataset.js --check   exit 1 if the committed file is not what this builds

   ---- Which files (checked fresh, not assumed; G06 §3(b) asked) ----
   The registry G0/G4/G5 already use: tests/bench/corpus/references.json, set "method". A file excluded by
   tests/bench/corpus/excluded.json - P1 (licence quarantine) or L8 (reference bar integrity) - has no entry
   there. This script does not trust that: it fails if any excluded id is registered, and it lists every
   catalogue file it leaves out and why. `holdout` is the registry's own flag (pppbench/corpus.py
   holdout_for: fnv1a32(id) % 5 == 0 for hymns and method); it is copied, never decided here. Hold-out files
   are in the dataset so the final model can be tested on them once (difficulty/tools/train.js); they never
   enter any training set.

   ---- Labels (course.js read, not paraphrased) ----
   stage: course.js PATH's own stage number (1 beyer, 2 czerny599, 3 czerny849, 4 czerny299). A `with` book
     takes the stage of the one step that lists it (chooseWithPath fills the "side" slot, studied ALONGSIDE
     that step: burgmuller25 -> 2, sonatina -> 3). A `with` book listed by several steps has no stage:
     hanon is in the with-list of stages 2, 3 and 4, and chooseWithPath puts it in the "warm" slot - a daily
     warm-up carried through the course, not a step of it. So hanon gets stage null and no ordinal label.
   order: the position inside a book that the book itself claims, or null where it claims none.
     beyer, czerny599, czerny849, burgmuller25 ("25 Easy and Progressive Studies"): the opus number.
     sonatina: the album numbers MOVEMENTS of works by three composers (Clementi Op. 36, then Kuhlau,
       then Beethoven Anh. 5). Movements of one sonatina are not in difficulty order (a slow movement is not
       harder than the first), and Kuhlau Op. 55 No. 1 is not harder than Op. 20 No. 1 because it is printed
       later. The one graded set inside it is Clementi's Op. 36 (Nos. 1-6): order = the sonatina number, and
       only different sonatinas are ever compared. Kuhlau and Beethoven movements keep their stage only.
     hanon: null (see stage).
   Pairs are built from these in train.js; nothing here compares two pieces. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const F = require(path.join(REPO, 'difficulty', 'features.js'));
const { legacyDifficulty, appScoreOf } = require(path.join(REPO, 'tests', 'difficulty', 'legacy-difficulty-extract.js'));
require(path.join(REPO, 'course.js'));
const COURSE = globalThis.PPP_COURSE;

const OUT = path.join(__dirname, 'dataset', 'method-books.json');
const REFS = path.join(REPO, 'tests', 'bench', 'corpus', 'references.json');
const EXCL = path.join(REPO, 'tests', 'bench', 'corpus', 'excluded.json');
const INDEX = path.join(REPO, 'catalog', 'method', 'index.json');

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/* stage per book, from course.js PATH (see the header) */
function stages() {
  const out = {};
  const withCount = {};
  COURSE.PATH.forEach(step => {
    out[step.book] = step.stage;
    step.with.forEach(w => { withCount[w] = (withCount[w] || 0) + 1; out[w] = out[w] === undefined ? step.stage : null; });
  });
  Object.keys(withCount).forEach(w => { if (withCount[w] > 1) out[w] = null; });
  return out;
}

const CLEMENTI = /^Clementi · Sonatina Op\. 36 No\. (\d+) · /;
function orderOf(book, piece) {
  if (book === 'hanon') return null;
  if (book === 'sonatina') {
    const m = CLEMENTI.exec(piece.title || '');
    return m ? Number(m[1]) : null;
  }
  return piece.no;
}

/* The app's legacy numbers for one Score (tests/difficulty/legacy-difficulty-extract.js). Neither legacy
   function ranks PIECES - deriveSections scores 8-bar sections inside one piece and flags its own top third
   `hard`, Coach.structural picks one hardest section - so every way of reading a piece-level order out of
   them is recorded, and train.js measures all of them. */
function legacyOf(score) {
  const L = legacyDifficulty();
  const secs = score.sections || [];
  const scores = secs.map(s => s.score);
  const whole = L.deriveSections(score, Math.max(1, score.measures.length));
  const st = L.structural(score);
  const key = s => s.notesPerMeasure + s.widestLeapSemitones;
  const measuresIn = s => Math.max(1, s.to - s.from + 1);
  const total = secs.reduce((a, s) => a + measuresIn(s), 0) || 1;
  return {
    sectionMax: scores.length ? Math.max.apply(null, scores) : 0,
    sectionMean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    whole: whole.length ? whole[0].score : 0,
    structuralMax: st.sections.length ? Math.max.apply(null, st.sections.map(key)) : 0,
    structuralTraits: st.hardest ? st.hardest.traits.length : 0,
    hardShare: secs.filter(s => s.hard).reduce((a, s) => a + measuresIn(s), 0) / total
  };
}

async function build() {
  const refs = readJson(REFS).references.filter(r => r.set === 'method');
  const excluded = readJson(EXCL).excluded;
  const byId = new Map(refs.map(r => [r.id, r]));
  const leaked = excluded.filter(e => byId.has(e.id));
  if (leaked.length) throw new Error('excluded ids registered in references.json: ' + leaked.map(e => e.id).join(', '));
  const excludedById = new Map(excluded.map(e => [e.id, e]));
  const stageOf = stages();
  const index = readJson(INDEX);

  const records = [];
  const left = [];
  const counts = {};
  for (const b of index.books) {
    counts[b.id] = { files: b.pieces.length, registered: 0, holdout: 0, excluded: {} };
    for (const piece of b.pieces) {
      const id = 'method/' + b.id + '/' + String(piece.no).padStart(3, '0');
      const ref = byId.get(id);
      if (!ref) {
        const ex = excludedById.get(id);
        const rule = ex ? ex.rule : 'unregistered';
        counts[b.id].excluded[rule] = (counts[b.id].excluded[rule] || 0) + 1;
        left.push({ id: id, rule: rule });
        continue;
      }
      counts[b.id].registered++;
      if (ref.holdout) counts[b.id].holdout++;
      const rel = 'catalog/method/' + piece.file;
      const imp = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'g6a' });
      if (!imp.ok) throw new Error('import failed: ' + rel + ' ' + imp.code);
      const feats = F.featuresOf(imp.graph);
      records.push({
        id: id, book: b.id, no: piece.no,
        stage: stageOf[b.id] === undefined ? null : stageOf[b.id],
        order: orderOf(b.id, piece),
        holdout: !!ref.holdout,
        beats: feats.beats, attacks: feats.attacks, handFallback: feats.handFallback,
        features: feats.piece,
        legacy: legacyOf(appScoreOf(SG, imp.graph, id))
      });
    }
  }
  return {
    schema: 'ppp.difficulty-dataset/1',
    featuresVersion: F.VERSION,
    featureNames: F.FEATURE_NAMES,
    registry: { references: sha(REFS), excluded: sha(EXCL) },
    path: COURSE.PATH,
    stages: stageOf,
    counts: counts,
    leftOut: left,
    records: records
  };
}

if (require.main === module) {
  build().then(data => {
    const text = JSON.stringify(data, null, 1) + '\n';
    if (process.argv.includes('--check')) {
      const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
      if (now !== text) { console.error('difficulty dataset is stale: run node difficulty/tools/build-dataset.js'); process.exitCode = 1; return; }
      console.log('difficulty dataset up to date:', data.records.length, 'records');
      return;
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log('wrote', data.records.length, 'records to', path.relative(REPO, OUT));
    Object.keys(data.counts).forEach(b => console.log(' ', b, JSON.stringify(data.counts[b]), 'stage', data.stages[b]));
  }).catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = { build, stages, orderOf, legacyOf, OUT };
