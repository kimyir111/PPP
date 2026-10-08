'use strict';
/* Would the suite notice if omr/apply.js got worse? (docs/GOALS/G12_OMR.md section 12, gate A2: "mutation checks")

   omr/apply.js is mutated the way tests/omr/normalize/mutation.test.js mutates the normaliser: a whole copy of the module with ONE line broken, loaded from a
   temp directory so the real one is untouched. The scenarios (scenarios.js) that read it must say ok for the real module and not ok (or throw) for the
   mutant. A mutation whose anchor has drifted fails loudly (it must match exactly once); MUT-NOOP is the control (a comment: nothing moves). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib.js');
const { S } = require('./scenarios.js');

const SRC = path.join(L.REPO, 'omr', 'apply.js');
const roots = [];
let counter = 0;
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));
const source = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

function mutant(edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 90)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  const wired = text.replace("require('../scoregraph/index.js')", () => 'require(' + JSON.stringify(path.join(L.REPO, 'scoregraph', 'index.js')) + ')');
  assert.notEqual(wired, text, 'the require was rewired');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-apply-mutant-' + (++counter) + '-'));
  roots.push(dir);
  const file = path.join(dir, 'apply.js');
  fs.writeFileSync(file, wired);
  return require(file);
}

/* the scenarios that see a mutant: ok false, or a throw */
const sees = (M, name) => { try { return !S[name].run(M).ok; } catch (e) { return true; } };

const MUTATIONS = [
  { id: 'MUT-DIFF-PITCH-BLIND', why: 'diff does not see a changed pitch or accidental',
    edits: [["if (a.p !== b.p || (a.acc || null) !== (b.acc || null)) {", "if (false) {"]], scenarios: ['accidental', 'accidentalCarry', 'ottava', 'ottavaDown', 'everything'] },
  { id: 'MUT-DIFF-ACC-BLIND', why: 'diff does not see a printed accidental on a note whose pitch did not change (a natural sign on a natural note)',
    edits: [["if (a.p !== b.p || (a.acc || null) !== (b.acc || null)) {", "if (a.p !== b.p) {"]], scenarios: ['accidentalCourtesy'] },
  { id: 'MUT-DIFF-NO-DROPS', why: 'diff does not see the notes the page has no heads for',
    edits: [["gone.forEach((hs, ev) => f.drops.push({ event: ev, heads: hs.slice().sort(), of: headsOf.get(ev).length }));", ""]], scenarios: ['phantom'] },
  { id: 'MUT-DIFF-NO-MOVES', why: 'diff does not see a note that moved in its bar',
    edits: [["      if (!close(a.b, b.b)) {", "      if (false) {"]], scenarios: ['phantom', 'realign'] },
  { id: 'MUT-DIFF-NO-ARPS', why: 'diff does not see the arpeggio marks',
    edits: [["if (a.arp && !b.arp) {", "if (false) {"]], scenarios: ['arpeggio'] },
  { id: 'MUT-DIFF-NO-CHORDS-IN', why: 'diff does not see the chord names the page printed',
    edits: [["f.chordsIn.push({ m: c.m, b: c.b, text: c.text })", "void c"]], scenarios: ['chords', 'everything'] },
  { id: 'MUT-DIFF-NO-CHORDS-OUT', why: 'diff does not see the chord names the page replaced',
    edits: [["f.chordsOut.push({ m: c.m, b: c.b, text: c.text })", "void c"]], scenarios: ['chords'] },
  { id: 'MUT-DIFF-NO-MARKS-IN', why: 'diff does not see the segno, coda and jump words the page printed',
    edits: [["f.marksIn.push({ m: k.m, kind: k.kind, text: k.text === undefined ? null : k.text })", "void k"]], scenarios: ['marks', 'everything'] },
  { id: 'MUT-DIFF-NO-MARKS-OUT', why: 'diff does not see the marks the page replaced',
    edits: [["f.marksOut.push({ m: k.m, kind: k.kind, text: k.text === undefined ? null : k.text })", "void k"]], scenarios: ['marks'] },
  { id: 'MUT-DIFF-NO-OTTAVAS', why: 'diff does not see the 8va brackets',
    edits: [["f.ottavas.push({ staff: o.staff, m: o.m, b: o.b, endM: o.endM, endB: o.endB, dir: o.dir, size: o.size, semitones: o.semitones })", "void o"]], scenarios: ['ottava', 'ottavaDown'] },
  { id: 'MUT-DIFF-NO-TEMPO', why: 'diff does not see the tempo the page marked',
    edits: [["h.tempo = Math.round(after.tempo);", "void 0;"]], scenarios: ['heading'] },
  { id: 'MUT-DROP-PARTIAL-CHORD', why: 'a phantom that is only some heads of a chord removes the whole chord',
    edits: [["      if (it.heads !== undefined && it.heads.length < have) throw new Skip('only some heads of a chord are phantoms: not removed');\n", "\n"]], scenarios: ['partialChord'] },
  { id: 'MUT-DROP-STALE', why: 'a phantom is removed from an event that is no longer the one the finding was made for',
    edits: [["if (it.of !== undefined && it.of !== have) throw", "if (false) throw"]], scenarios: ['staleDrop'] },
  { id: 'MUT-DROP-NOT-DONE', why: 'the phantom is found and counted but the event stays',
    edits: [["      d.removeEvents([it.event]);\n      return 'applied';", "      return 'applied';"]], scenarios: ['phantom'] },
  { id: 'MUT-PITCH-ACC-LOST', why: 'the printed accidental is not written',
    edits: [["      if (it.acc !== undefined) {\n        const cur", "      if (false) {\n        const cur"]], scenarios: ['accidental', 'accidentalCourtesy'] },
  { id: 'MUT-NO-PROVENANCE', why: 'the edited head carries no mark of where the edit came from',
    edits: [["      d.markProv(x.h, aspects, 'inferred');", "      void aspects;"]], scenarios: ['provenance'] },
  { id: 'MUT-PROVENANCE-GENERATED', why: 'the edit says op "generated" and not "inferred"',
    edits: [["      d.markProv(x.e, ['rhythm'], 'inferred');", "      d.markProv(x.e, ['rhythm'], 'generated');"]], scenarios: ['provenance'] },
  { id: 'MUT-SOURCE-NOT-OMR', why: 'the source of the edits is not named omr / pdflayer',
    edits: [["const SOURCE = Object.freeze({ kind: 'omr', tool: 'pdflayer', version: '1' });", "const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g3', version: '1' });"]], scenarios: ['provenance'] },
  { id: 'MUT-MOVE-DIRECTION-STAYS', why: 'a dynamic mark that belongs to a note stays where the note was',
    edits: [["      d.doc.parts.forEach(p => p.directions.forEach(dir => { if (dir.event === x.e.id) dir.at = text; }));\n", "\n"]], scenarios: ['movedDynamic'] },
  { id: 'MUT-BEAMS-KEPT-WHEN-SPLIT', why: 'a beam over events only some of which moved is kept',
    edits: [["      const gone = new Set();\n      part.spanners = part.spanners.filter(s => {", "      const gone = new Set();\n      if (part) return;\n      part.spanners = part.spanners.filter(s => {"]], scenarios: ['beamsKept'] },
  { id: 'MUT-BEAMS-RETIRED-WHEN-WHOLE', why: 'a beam over events that all moved together is retired too',
    edits: [["|| s.events.every(e => moved.has(e))) return true;", ") return true;"]], scenarios: ['beamsKept'] },
  { id: 'MUT-ARP-ONE-NOTE', why: 'an arpeggio of one note is written (the validator or the importer would drop it)',
    edits: [["if (heads.length < 2) throw new Skip('an arpeggio needs two notes');", "if (heads.length < 1) throw new Skip('an arpeggio needs two notes');"]], scenarios: ['arpSingle'] },
  { id: 'MUT-ARP-TWICE', why: 'an arpeggio the graph already has is written again',
    edits: [["if (part.spanners.some(s => s.type === 'arpeggio' && heads.every(h => s.heads.indexOf(h) >= 0))) return 'already';", ""]], scenarios: ['idempotentRich'] },
  { id: 'MUT-OTTAVA-END-IN-QUARTERS', why: 'the bracket ends 0.001 quarter after its last note starts, as PdfLayer writes it, instead of where that note ends',
    edits: [["      if (!to) to = L.ratQ(it.endB || 0);", "      to = L.ratQ(it.endB || 0);"]], scenarios: ['ottava'] },
  { id: 'MUT-OTTAVA-ALWAYS-UP', why: 'an 8vb is written as an 8va',
    edits: [["const shift = (it.dir > 0 ? 1 : -1) * octaves;", "const shift = octaves;"]], scenarios: ['ottavaDown'] },
  { id: 'MUT-OTTAVA-TWICE', why: 'a bracket the graph already has is written again',
    edits: [["if (st.part.spanners.some(s => s.type === 'ottava' && s.staff === x.staff && s.shift === x.shift && sameJson(s.from, x.from) && sameJson(s.to, x.to))) return 'already';", ""]], scenarios: ['idempotentRich', 'idempotent'] },
  { id: 'MUT-MARK-DS-AS-SEGNO', why: 'D.S. is written as a segno',
    edits: [["dc: 'dacapo', ds: 'dalsegno'", "dc: 'dacapo', ds: 'segno'"]], scenarios: ['marks'] },
  { id: 'MUT-TEMPO-NOT-WRITTEN', why: 'the tempo the page marked is not written',
    edits: [["        else { tl.tempos.push({ id: d.newId('tp'), m: first.id, at: '0', qpm: qpm }); changed = true; }", "        else changed = changed || false;"]], scenarios: ['heading'] },
  { id: 'MUT-DROP-MISSING-IS-AN-ERROR', why: 'a phantom that is already gone is reported as a failure',
    edits: [["if (!x) return 'already';", "if (!x) throw new Skip('no such event');"]], scenarios: ['missingTargets'] },
  { id: 'MUT-PITCH-MISSING-IS-DONE', why: 'a pitch for a note that is not there is counted as already made',
    edits: [["      if (!x) throw new Skip('no such note');", "      if (!x) return 'already';"]], scenarios: ['missingTargets'] },
  { id: 'MUT-NO-HALVING', why: 'one edit the graph refuses costs the whole list',
    edits: [["      if (entries.length === 1) {", "      if (entries.length >= 1) {"]], scenarios: ['isolation'] },
  { id: 'MUT-ALREADY-COUNTED-AS-APPLIED', why: 'an edit that was already true is counted as made',
    edits: [["entries.forEach((en, i) => (r.result[i] === 'applied' ? applied : already).push(en));", "entries.forEach((en, i) => applied.push(en));"]], scenarios: ['idempotent', 'idempotentRich'] },
  { id: 'MUT-CHANGED-ALWAYS', why: 'apply says it changed the graph when it did not',
    edits: [["changed: r.graph !== graph,", "changed: true,"]], scenarios: ['noChange', 'idempotent'] },
  { id: 'MUT-MARK-OMR-HANDS', why: 'the OMR mark does not say how hands are given',
    edits: [["const want = Object.assign({ hands: 'by-staff' }, info || {});", "const want = Object.assign({ hands: 'none' }, info || {});"]], scenarios: ['handRule'] },
  { id: 'MUT-MARK-OMR-NOT-IDEMPOTENT', why: 'marking a graph that is already marked makes another revision',
    edits: [["      if (cur && sameJson(cur, want)) return;\n", "\n"]], scenarios: ['handRule'] }
];

test('MUT-NOOP: the control. A comment is added and nothing moves', () => {
  const M = mutant([["const VERSION = 1;", "const VERSION = 1; /* a comment */"]]);
  for (const name of Object.keys(S)) assert.equal(sees(M, name), false, name);
});

test('the real module passes every scenario the mutants are measured against', () => {
  for (const name of Object.keys(S)) assert.equal(sees(L.A, name), false, name);
});

for (const m of MUTATIONS) {
  test(m.id + ': ' + m.why, () => {
    const M = mutant(m.edits);
    const seen = m.scenarios.map(n => [n, sees(M, n)]);
    const blind = seen.filter(x => !x[1]).map(x => x[0]);
    assert.deepEqual(blind, [], 'the scenarios that do not see this mutant: ' + blind.join(', '));
  });
}

test('every scenario is read by at least one mutation: no scenario is dead weight', () => {
  const used = new Set([].concat.apply([], MUTATIONS.map(m => m.scenarios)));
  assert.deepEqual(Object.keys(S).filter(n => !used.has(n)), []);
});
