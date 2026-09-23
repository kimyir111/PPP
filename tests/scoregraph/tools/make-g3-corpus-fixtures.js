#!/usr/bin/env node
/* Writes tests/scoregraph/fixtures/g3/corpus/ (docs/GOALS/G03 §19, Step 2): the bars of the ten before/after
   examples, cut from the graph audio-score.js makes for each core case today.

     node tests/scoregraph/tools/make-g3-corpus-fixtures.js

   Each fixture is PPP's own output (never the reference's text: the reference is named by its path in the
   sidecar). The sidecar records the case, the printed bars, what the bars read now ("before", in the
   tests/scoregraph/g3-helpers.js language) and what G3a is expected to do (§19's After column). Rerun only when
   audio-score.js changes what it writes; the before strings then show the change. */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./g3-graphs.js');
const { render } = require('../g3-helpers.js');
const SG = require('../../../scoregraph/index.js');

const DIR = path.join(__dirname, '..', 'fixtures', 'g3', 'corpus');
/* [name, case, first printed bar, last printed bar, reference, G3a expectation (§19 After)] */
const CASES = [
  ['E01', 'method/czerny849/007|human|oracle|s1', 3, 3, 'catalog/method/czerny849/007.mxl',
    'broken rhythm (release policy): G3a keeps every notated length (R-repr); the 32nd + 32nd rest pairs stay. G3b (off) would write 16ths and a second LH voice'],
  ['E02', 'method/czerny849/001|human|oracle|s1', 17, 17, 'catalog/method/czerny849/001.mxl',
    'rests and broken tuplets and hands: one bracket per beat of triplets, rests inside triplets carry the ratio (no W-DISPLAY-DURATION), no one-note bracket'],
  ['E03', 'method/burgmuller25/021|deadpan|none|s1', 3, 3, 'catalog/method/burgmuller25/021.mxl',
    'triplet rest shapes and hands: one bracket per triplet group, every rest printed at its length'],
  ['E04', 'method/czerny849/001|human|oracle|s1', 11, 11, 'catalog/method/czerny849/001.mxl',
    'one-note brackets (F1): 12 brackets become one per beat group; LH quarter-triplet + triplet-eighth rest as one group'],
  ['E05', 'method/sonatina/018|human|oracle|s1', 10, 17, 'catalog/method/sonatina/018.mxl',
    'everything + spelling (bar 14 is the example): 64th-rest pairs merge (R-repr), triplets grouped; the key estimated by windows'],
  ['E06', 'method/beyer/032|human|oracle|s1', 1, 2, 'catalog/method/beyer/032.mxl',
    'wrong hand (parallel octaves): the octave pairs are split between the hands, RH upper and LH lower'],
  ['E07', 'method/czerny849/006|human|oracle|s1', 9, 9, 'catalog/method/czerny849/006.mxl',
    'wrong staff: the melody D5 of beat 2 moves back to the right hand'],
  ['E08', 'method/burgmuller25/023|human|oracle|s1', 37, 37, 'catalog/method/burgmuller25/023.mxl',
    'needless tie in 6/8: 8~16~32 becomes the shortest writing that shows the dotted-quarter beat; the metre is not changed'],
  ['E08b', 'catalog/gymnopedie-1|deadpan|none|s1', 5, 5, 'catalog/gymnopedie-1.musicxml',
    'a quarter written 8.~16 in a 6/8 that should be 3/4: correct for 6/8 (H4), so G3 leaves it; the metre is issue 2, not G3'],
  ['E09', 'method/sonatina/017|human|oracle|s1', 30, 37, 'catalog/method/sonatina/017.mxl',
    'spelling unrelated to the key (bar 34 is the example): the key estimated by windows; E#2 is the F of the local key'],
  ['E10', 'method/burgmuller25/003|human|oracle|s1', 28, 28, 'catalog/method/burgmuller25/003.mxl',
    'compound rests and ties in 6/8: rests shown inside the beat; the lengths kept']
];

fs.mkdirSync(DIR, { recursive: true });
const want = new Set(CASES.map(c => 'core:' + c[1]));
const rows = new Map(G.graphs('core', { filter: id => want.has(id) }).map(r => [r.id.slice(5), r]));
CASES.forEach(([name, key, a, b, ref, expect]) => {
  const r = rows.get(key);
  if (!r || !r.graph) throw new Error(key + ': ' + (r ? r.error : 'not in core'));
  const ms = r.graph.timeline.measures;
  const from = ms.findIndex(m => m.number === String(a)), to = ms.findIndex(m => m.number === String(b));
  if (from < 0 || to < from) throw new Error(key + ': no bars ' + a + '-' + b);
  const g = G.slice(r.graph, from, to);
  fs.writeFileSync(path.join(DIR, name + '.sg.json'), SG.serialize(g));
  const side = {
    about: '§19 ' + name + ': PPP output for ' + key + ', printed bars ' + a + (b !== a ? '-' + b : ''),
    spec: 'G03 §19',
    case: key, bars: [a, b], reference: ref,
    before: render(g),
    expect: { g3a: expect }
  };
  fs.writeFileSync(path.join(DIR, name + '.expect.json'), JSON.stringify(side, null, 1) + '\n');
  console.log(name, key, a + '-' + b, '\n  ' + side.before.join('\n  '));
});
