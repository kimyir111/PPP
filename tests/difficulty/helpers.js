/* Shared helpers for tests/difficulty/*.test.js (node --test, no dependencies; docs/GOALS/G06_DIFFICULTY.md G6a).

   Fixtures are written in tests/scoregraph/g3-helpers.js's mk() notation, the language G3/G5 tests already use.
   Real pieces come from the G6a dataset's own registry reading (difficulty/tools/dataset/method-books.json):
   only NON-hold-out files are ever opened here, the same rule tests/engrave/helpers.js corpusFiles() keeps for
   G4 - the registry's hold-out stays independent, and no hold-out value is reported per file by any test. */
'use strict';
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const D = require(path.join(REPO, 'difficulty', 'index.js'));
const F = D.features;
const M = D.model;
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));

const DATASET = path.join(REPO, 'difficulty', 'tools', 'dataset', 'method-books.json');
const WEIGHTS = path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json');

let weightsCache = null;
function weights() { return weightsCache || (weightsCache = JSON.parse(fs.readFileSync(WEIGHTS, 'utf8'))); }
function dataset() { return JSON.parse(fs.readFileSync(DATASET, 'utf8')); }

const graphCache = new Map();
async function graphOf(rel) {
  if (graphCache.has(rel)) return graphCache.get(rel);
  const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'g6a-test' });
  const g = r.ok ? r.graph : null;
  graphCache.set(rel, g);
  return g;
}
const relOf = rec => 'catalog/method/' + rec.book + '/' + String(rec.no).padStart(3, '0') + '.mxl';

/* A spread of non-hold-out pieces across every book in the dataset: the first, middle and last registered
   non-hold-out piece of each (by number) - deterministic, and never a hold-out file. */
function samplePieces() {
  const recs = dataset().records.filter(r => !r.holdout);
  const out = [];
  Array.from(new Set(recs.map(r => r.book))).forEach(b => {
    const list = recs.filter(r => r.book === b).sort((x, y) => x.no - y.no);
    [0, Math.floor(list.length / 2), list.length - 1].forEach(i => { if (list[i] && !out.includes(list[i])) out.push(list[i]); });
  });
  return out;
}

/* A mutable deep copy (imported and mk() graphs are deep-frozen). The copy's top level is frozen again after
   `mutate` runs, so scoregraph/time.js keeps caching its measure context for it; nothing reads it back through
   an importer or validator - only difficulty/features.js, which only reads. */
function edited(g, mutate) {
  const c = JSON.parse(JSON.stringify(g));
  mutate(c);
  return Object.freeze(c);
}

/* Multiply every notated tempo by k. A graph with no tempo event plays at the default qpm, so the caller passes
   the same k to featuresOf through `qpmScale` (see scoreAt). */
function withTempo(g, k) {
  const R = SG.rational;
  return edited(g, c => {
    (c.timeline.tempos || []).forEach(t => {
      if (t.qpm === undefined) return;
      t.qpm = R.format(R.mul(R.parse(t.qpm), R.make(Math.round(k * 1000), 1000)));
    });
  });
}
function scoreAt(g, k) {
  const W = weights();
  return M.scoreOf(F.featuresOf(g, { defaultQpm: 120 * k }).piece, W);
}

/* Transpose a whole graph by an interval (diatonic steps, semitones), key signatures with it: every pitch
   through scoregraph/pitch.js transpose (spelling kept), every printed accidental kept (a transposition that
   moves the key signature with the notes needs exactly the same accidentals, retyped), every KeyEvent's
   fifths moved by the interval's own fifths (7 * semitones - 12 * steps, as pitch.js concertFifths). */
const ACC_OF_ALTER = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
function fifthsOfInterval(diatonic, chromatic) { return 7 * chromatic - 12 * diatonic; }
function transposed(g, diatonic, chromatic) {
  const df = fifthsOfInterval(diatonic, chromatic);
  return edited(g, c => {
    (c.timeline.keys || []).forEach(k => { k.fifths += df; });
    c.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => {
      if (!h.pitch) return;
      h.pitch = SG.pitch.transpose(h.pitch, diatonic, chromatic);
      if (h.acc) h.acc = Object.assign({}, h.acc, { type: ACC_OF_ALTER[h.pitch.alter || 0] || h.acc.type });
    })));
  });
}

/* Remove notes: every note event `drop(event, part)` selects becomes a rest of the same length (the bar stays
   full); `dropHead(head, event)` removes single chord tones (an event keeps at least one head). */
function withoutNotes(g, drop, dropHead) {
  return edited(g, c => c.parts.forEach(p => p.events.forEach(e => {
    if (e.kind !== 'note') return;
    if (drop && drop(e, p)) { e.kind = 'rest'; delete e.heads; delete e.arts; delete e.orn; delete e.lyrics; return; }
    if (dropHead && e.heads && e.heads.length > 1) {
      const keep = e.heads.filter(h => !dropHead(h, e));
      e.heads = keep.length ? keep : [e.heads[0]];
    }
  })));
}

module.exports = { REPO, D, F, M, SG, mk, weights, dataset, graphOf, relOf, samplePieces, edited, withTempo, scoreAt,
  transposed, fifthsOfInterval, withoutNotes };
