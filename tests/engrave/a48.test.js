/* G04 A48: toScore(fromScore(S)) ≡ S for the Score the app really holds (final review MAJOR 5).

   Population A is every committed import file that opens (G04 A47/A48: 504 - MusicXML, MXL, MIDI), read the way the
   app reads a file: Score.finalize(legacy.toScore(graph)) - with Score.finalize taken from the app itself, so the 8va
   move, soundingMidi, writtenP / writtenMidi and the note order are the app's. Population C is the Scores captured
   from the running app (recording, parsed, imported, stored and read back, the demo). The core 553 recording Scores
   come from the app's own MusicXML reader, which needs a browser: tests/engrave/tools/a48-coverage.js (local gate).

   The comparison is strict and field by field - every note field the app keeps, written and sounding pitch, the
   microtone approximation, positions, measures, and every list - with nothing rounded but floating noise (1e-9).
   What a legacy Score cannot carry is allowlisted by file, by the code fromScore names it with, and by the only
   fields it may change; anything else that differs is a new loss and fails. A G0 hold-out file is checked like the
   others and never named in a message (G0 rule). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, storedScores, holdoutPaths, appFinalize } = require('./helpers.js');

const L = SG.legacy;

/* ------------------------------------------------ Score.finalize, from the app (helpers.appFinalize) */
const finalize = appFinalize();

/* ------------------------------------------------ the committed import files */
const SKIP = new Set(['node_modules', '.git', 'tmp', 'out', '.cache', '__pycache__', 'data']);
function importFiles() {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      if (SKIP.has(e.name)) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      const rel = path.relative(REPO, p).split(path.sep).join('/');
      if (/\.(musicxml|mxl|mid)$/i.test(e.name) || (/\.xml$/i.test(e.name) && /score|musicxml|fixtures|catalog|golden|corpus|human/i.test(rel))) out.push(rel);
    });
  })(REPO);
  return out.sort();
}

/* ------------------------------------------------ the strict comparison (shared with the page gate) */
const A48 = require('./a48-compare.js');
const fieldsThatDiffer = (a, b) => A48.fieldsThatDiffer(L, a, b);

/* What a legacy Score cannot carry, by file: the code fromScore must name, and the only fields it may change.
   Nothing else is allowed to differ, in these files or any other. */
const KNOWN_LOSS = {
  'tests/scoregraph/fixtures/xml/unpitched.musicxml': { code: 'percussion-or-unpitched', fields: ['notes.count'] },
  'tests/scoregraph/fixtures/xml/transposing.musicxml': { code: 'transposition', fields: ['notes.writtenMidi', 'notes.writtenP'] },
  'tests/scoregraph/fixtures/xml/microtone-quarter-sharp.musicxml': { code: 'microtone', fields: ['notes.approx'] },
  'tests/engrave/fixtures/e/E27-percussion.musicxml': { code: 'percussion-or-unpitched', fields: ['notes.count'] }
};

function roundTrip(score) {
  const fr = L.fromScore(score);
  if (!fr.ok) return { ok: false, fields: ['fromScore'], codes: (fr.unsupported || []).map(u => u.code) };
  const back = finalize(L.toScore(fr.graph, { name: 'back', id: score.id }));
  return { ok: true, fields: fieldsThatDiffer(score, back), codes: fr.unsupported.map(u => u.code), agree: L.agree(score, fr.graph).ok };
}

test('A48 (A): every committed import file, as the app holds it after the import, comes back from its rebuilt graph', async (t) => {
  const holdout = holdoutPaths();
  const files = importFiles();
  const bad = [], allowed = [], counts = { files: files.length, opened: 0, exact: 0, known: 0 };
  const name = rel => (holdout.has(rel) ? 'a G0 hold-out file' : rel);
  for (const rel of files) {
    const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'a48' });
    if (!r.ok) continue;
    counts.opened++;
    const score = finalize(L.toScore(r.graph, { name: path.basename(rel), id: 'a48:' + rel }));
    const rt = roundTrip(score);
    const known = KNOWN_LOSS[rel];
    if (!rt.fields.length) { counts.exact++; if (known) bad.push(name(rel) + ': allowlisted but no longer loses anything - take it off the list'); continue; }
    if (A48.knownLoss(known, rt.codes, rt.fields)) {
      counts.known++; allowed.push(rel.split('/').pop() + ' ' + known.code); continue;
    }
    bad.push(name(rel) + ': ' + rt.fields.join(', ') + (rt.codes.length ? ' (named: ' + rt.codes.join(', ') + ')' : ' (nothing named)'));
  }
  t.diagnostic(counts.opened + ' of ' + counts.files + ' files open: ' + counts.exact + ' exact, ' + counts.known + ' known losses (' + allowed.join('; ') + ')');
  assert.deepEqual(bad, []);
  assert.ok(counts.opened >= 504, counts.opened + ' files opened (G04 A47: 504)');
  assert.equal(counts.known, Object.keys(KNOWN_LOSS).length, 'every allowlisted loss is still met, and named');
});

test('A48 (C): the Scores captured from the running app - recording, parsed, imported, stored and read back, the demo', () => {
  const bad = [];
  const all = storedScores();
  all.forEach(([f, x]) => {
    const rt = roundTrip(JSON.parse(JSON.stringify(x.score)));
    if (!rt.ok || rt.fields.length) bad.push(f + ' (' + x.how + '): ' + rt.fields.join(', '));
  });
  assert.equal(all.length, 13);
  assert.ok(all.some(([f]) => f.startsWith('stored-')), 'Scores read back from a song slot are among them');
  assert.deepEqual(bad, []);
});

test('A48: the comparison is not blind - a written pitch, an approximation, an 8va shift, a note fewer each differ', async () => {
  const g = (await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, 'tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml'))), { name: 'o', scoreId: 'a48' })).graph;
  const s = finalize(L.toScore(g, { name: 'o', id: 'a48:o' }));
  const clone = () => JSON.parse(JSON.stringify(s));
  const i = s.notes.findIndex(n => !n.rest);
  const w = clone(); w.notes[i].writtenP = 'C9'; assert.deepEqual(fieldsThatDiffer(s, w), ['notes.writtenP']);
  const ap = clone(); ap.notes[i].approx = 'microtone'; assert.deepEqual(fieldsThatDiffer(s, ap), ['notes.approx']);
  const k = s.notes.findIndex(n => n.ottavaShift);
  assert.ok(k >= 0, 'the fixture has a note under an 8va');
  const sh = clone(); sh.notes[k].ottavaShift = 0; assert.deepEqual(fieldsThatDiffer(s, sh), ['notes.ottavaShift']);
  const fewer = clone(); fewer.notes.splice(i, 1); assert.ok(fieldsThatDiffer(s, fewer).indexOf('notes.count') >= 0);
  assert.deepEqual(fieldsThatDiffer(s, clone()), []);
});
