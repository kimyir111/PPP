/* Shared helpers for tests/engrave/*.test.js (node --test, no dependencies; docs/GOALS/G04 §27 G4a). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const E = require(path.join(REPO, 'engrave', 'index.js'));
const FIX = path.join(__dirname, 'fixtures');

const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));

/* The G0 hold-out references (tests/bench/corpus/references.json, 52 of 312): kept out of every G4 test and set, so
   G0's hold-out stays independent and no hold-out value is ever reported per file (G04 §22.2). */
function holdoutPaths() {
  const r = json(path.join(REPO, 'tests', 'bench', 'corpus', 'references.json'));
  return new Set(r.references.filter(x => x.holdout).map(x => x.path));
}
/* The committed scores a G4 test may read: every catalogue file the provenance record calls eligible (the 15
   quarantined ones are out of every suite, tests/bench/corpus/provenance.json policy) that is not a G0 hold-out
   reference, and the project's own fixtures - ScoreGraph MusicXML and MIDI fixtures, the engraving stress fixture,
   the OMR fixture. */
function corpusFiles() {
  const prov = json(path.join(REPO, 'tests', 'bench', 'corpus', 'provenance.json'));
  const holdout = holdoutPaths();
  const eligible = prov.entries.filter(e => e.eligible && !e.quarantine_reason && /\.(musicxml|xml|mxl)$/i.test(e.path)
    && !holdout.has(e.path) && fs.existsSync(path.join(REPO, e.path))).map(e => e.path);
  const own = [];
  [['tests/scoregraph/fixtures/xml', /\.musicxml$/], ['tests/scoregraph/fixtures/midi', /\.mid$/], ['tests/fixtures', /\.(musicxml|xml)$/],
    ['tests/bench/corpus/omr', /\.(musicxml|xml)$/], ['samples', /\.musicxml$/]].forEach(([d, re]) => {
    fs.readdirSync(path.join(REPO, d)).filter(f => re.test(f)).sort().forEach(f => own.push(d + '/' + f));
  });
  return [...new Set(eligible.sort().concat(own))];
}

const graphCache = new Map();
async function graphOf(rel) {
  if (graphCache.has(rel)) return graphCache.get(rel);
  const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'g4a' });
  const g = r.ok ? r.graph : null;
  graphCache.set(rel, g);
  return g;
}
/* [rel, graph] for every corpus file that opens (a MIDI file with fewer than four notes does not, G02 R4) */
async function corpusGraphs() {
  const out = [];
  for (const rel of corpusFiles()) { const g = await graphOf(rel); if (g) out.push([rel, g]); }
  return out;
}

/* The graphs toMusicXml makes for the 17 G0 golden inputs: PPP's own transcriptions, G3 off (no beams, a bracket per
   triplet piece, inferred ties). */
function goldenGraphs() {
  const d = path.join(REPO, 'tests', 'scoregraph', 'golden');
  return fs.readdirSync(d).filter(f => f.endsWith('.sg.json')).sort().map(f => ['golden/' + f, SG.parse(read(path.join(d, f)))]);
}
/* The same graphs through G3a, in the test only: production keeps G3 off (G3-U9). */
function g3aGraphs() {
  return goldenGraphs().map(([k, g]) => [k.replace('golden/', 'g3a/'), SG.professionalize(g, { mode: 'rewrite' }).graph]);
}

/* Legacy Scores captured from the real app (tests/engrave/tools/capture-legacy-scores.js): the Score objects the
   renderer and the practice layer hold today, finalized, and the packed form a song slot stores. */
function storedScores() {
  const d = path.join(FIX, 'legacy');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.score.json')).sort().map(f => [f, json(path.join(d, f))]);
}

/* What Score.finalize does to a toScore projection that matters to a comparison and to the practice layer: measure
   starts and absolute positions (App 3555). Its 8va move is exercised by the captured Scores, not re-implemented here. */
function withPositions(score) {
  let q = 0;
  const byNumber = {};
  score.measures.forEach(mm => { mm.startQ = q; q += mm.lenQ; byNumber[mm.number] = mm; });
  score.notes.forEach(n => { const mm = byNumber[n.m]; n.abs = (mm ? mm.startQ : 0) + n.b; });
  return score;
}

const scoreOf = (g, name) => withPositions(SG.legacy.toScore(g, { name: name || 'test', id: 'test:' + (name || g.id) }));

module.exports = { REPO, SG, E, FIX, read, json, holdoutPaths, corpusFiles, graphOf, corpusGraphs, goldenGraphs, g3aGraphs, storedScores,
  withPositions, scoreOf };
