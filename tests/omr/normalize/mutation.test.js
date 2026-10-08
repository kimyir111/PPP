'use strict';
/* Would the suite notice if the normaliser got worse? (docs/GOALS/G12_OMR.md section 12, gate A1: "each rule proven by a planted defect")

   omr/normalize.js is mutated here the way tests/practice/mutation.test.js mutates practice/plan.js: a whole copy of the module with ONE line
   broken, loaded from a temp directory so the real one is untouched. Each mutation is a thing an engine page would show: a movement lost, a
   half note read as a quarter, the lower staff written on the upper, the groups of a trio merged and their notes dropped. The scenario
   (scenarios.js: the pages, and the music written as one grand staff as the right answer) that reads it must give the real module's answer
   and not the mutant's. A mutation whose anchor has drifted fails loudly (it must match exactly once); MUT-NOOP is the control (a comment:
   nothing moves). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib.js');
const SC = require('./scenarios.js');
const { S, probe } = SC;
const { note, part, doc, read } = L;

const SRC = path.join(L.REPO, 'omr', 'normalize.js');
const roots = [];
let counter = 0;
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));
const source = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

function mutant(edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 80)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  const wired = text.replace("require('../scoregraph/xml.js')", () => 'require(' + JSON.stringify(path.join(L.REPO, 'scoregraph', 'xml.js')) + ')');
  assert.notEqual(wired, text, 'the require was rewired');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-normalize-mutant-' + (++counter) + '-'));
  roots.push(dir);
  const file = path.join(dir, 'normalize.js');
  fs.writeFileSync(file, wired);
  return require(file);
}

/* probes that are not a whole scenario */
const voicesOfLower = Nn => read(Nn.normalize(S.pair.pages()).xml).parts[0].bars[0].notes.filter(n => n.staff === 2).map(n => n.voice).join(',');
const lowerClef = Nn => read(Nn.normalize(S.pair.pages()).xml).parts[0].bars[0].clefs['2'];
const midClefs = Nn => {
  const mid = '<attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>';
  const r = Nn.normalize([doc([part('P1', [SC.rhBar(0, SC.first({ clefs: ['G'] })), Object.assign(SC.rhBar(1), { mid: mid })], { div: 2 }),
    part('P2', [SC.lhBar(0, SC.first({ clefs: ['F'] })), SC.lhBar(1)], { div: 2 })])]);
  return read(r.xml).parts[0].bars[1].midClefs;
};
const helperPages = Nn => JSON.stringify(Nn.pagesFromHelper({ movements: [['a', 'b']], musicxml: ['b'] }));
const headerKept = Nn => read(Nn.normalize(S.movements.pages()).xml).header.indexOf('identification') >= 0;
const widthKept = Nn => {
  const r = Nn.normalize([doc([part('P1', [{ items: [note('G4', 4, { type: 'whole' })], div: 1, time: [4, 4], clefs: ['G'], width: 90, number: 0 }])])]);
  return read(r.xml).parts[0].bars[0].attrs.width;
};
const dropped = Nn => {
  const grand = part('P1', [SC.grandBar(0, SC.grandFirst()), SC.grandBar(1), SC.grandBar(2), SC.grandBar(3)], { div: 2, staved: true });
  const junk = part('P2', [SC.restBar(SC.first({ clefs: ['G'] })), SC.restBar(), SC.restBar(), { items: [note('C6', 4, { type: 'whole' })] }], { div: 2 });
  const r = Nn.normalize([doc([grand, junk])]);
  return r.report.counts.droppedNotes + '/' + r.report.counts.overlapBars;
};

/* id, the mutation, the scenario that must see it (or a probe and what the real module answers) */
const MUTATIONS = [
  { id: 'MUT-MOVEMENTS-FIRST-ONLY', why: 'only the first movement of a page is read: the old helper\'s loss, in the normaliser',
    edits: [['texts.forEach((text, mi) => {', 'texts.slice(0, 1).forEach((text, mi) => {']], scenario: 'movements' },
  { id: 'MUT-MOVEMENTS-REVERSED', why: 'the movements (and pages) are joined last first',
    edits: [['movs.push({ page: pi, mv: mi + 1, doc: doc });', 'movs.unshift({ page: pi, mv: mi + 1, doc: doc });']], scenario: 'movements' },
  { id: 'MUT-RENUMBER', why: 'the bars are numbered from 0',
    edits: [['const attrs = { number: String(i + 1) };', 'const attrs = { number: String(i) };']], scenario: 'movements' },
  { id: 'MUT-DIV-UNREPAIRED', why: 'a divisions of 0 is read as 1, as the app reads it today: every half note a quarter',
    edits: [['    if (part.zero) {\n      let best = null, bestN = 0;', '    if (false) {\n      let best = null, bestN = 0;']], scenario: 'divisionsZero' },
  { id: 'MUT-DIV-NOT-SCALED', why: 'the repaired divisions is found but the durations are not scaled to whole numbers',
    edits: [['if (s) { b.k = s.k; b.D = s.D; }', 'if (s) { b.k = 1; b.D = s.D; }']], scenario: 'divisionsZero' },
  { id: 'MUT-DIV-NEVER-AGREES', why: 'the notes\' agreement is never enough: every repair becomes "unknown"',
    edits: [['bestN / zeroTotal >= 0.5', 'bestN / zeroTotal >= 1.5']], scenario: 'divisionsZero' },
  { id: 'MUT-DIV-GUESSED', why: 'divisions 0 with nothing to read it from is repaired anyway (to 1) and not said',
    edits: [['      else part.unknownDivisions = true;\n', '      else { part.unknownDivisions = false; part.zero = false; }\n']], scenario: 'divisionsUnknown' },
  { id: 'MUT-DURATIONS-UNSCALED', why: 'a page with other divisions is joined without scaling its durations to the common divisions',
    edits: [['if (d && f !== 1) { const v = num(d.text); if (v != null) d.text = String(Math.round(v * f)); }', 'if (false) { const v = num(d.text); if (v != null) d.text = String(Math.round(v * f)); }']], scenario: 'pages' },
  { id: 'MUT-NO-PAIR', why: 'two one-staff parts (G over F) are not joined into a grand staff: the hand rule then plays only the last',
    edits: [['else if (p.staves === 1 && q && q.staves === 1 && pairable(p, q))', 'else if (p.staves === 1 && q && q.staves === 1 && pairable(p, q) && false)']], scenario: 'pair' },
  { id: 'MUT-LOWER-ON-UPPER', why: 'the lower part\'s notes are written on staff 1',
    edits: [['const lower = fp ? convertBar(fp, dOut, 2, voiceOff, !upper) : null;', 'const lower = fp ? convertBar(fp, dOut, 1, voiceOff, !upper) : null;']], scenario: 'pair' },
  { id: 'MUT-NO-BACKUP', why: 'no <backup> between the staves: the lower staff starts after the upper one ends',
    edits: [["if (cur > 0) body.push(mk('backup'", "if (cur < 0) body.push(mk('backup'"]], scenario: 'pair' },
  { id: 'MUT-VOICES-COLLIDE', why: 'the lower staff keeps the voice numbers of the upper (both staves have a voice 1)',
    edits: [['const voiceOff = Math.max(4, gp ? gp.maxVoice : 0);', 'const voiceOff = 0;']], probe: voicesOfLower, clean: '5,5' },
  { id: 'MUT-CLEF-NUMBER', why: 'the clefs of a two-staff part are written without their staff number',
    edits: [['if (col.staves === 2) el.attrs.number = String(n); else delete el.attrs.number;', 'delete el.attrs.number;']], probe: lowerClef, clean: 'F' },
  { id: 'MUT-MID-CLEF-DROPPED', why: 'a clef change in the middle of a bar is dropped with the leading attributes',
    edits: [['        if (!content) return;\n        const c = mk(\'attributes\', {}, []);', '        return;\n        const c = mk(\'attributes\', {}, []);']], probe: midClefs, clean: 1 },
  { id: 'MUT-FIRST-GROUP-WINS', why: 'each bar comes from the first group that has the bar, whether or not it has the notes',
    edits: [['const n = g.pitchedAt(b); if (n > best)', 'const n = 1; if (n > best)']], scenario: 'systems' },
  { id: 'MUT-FIRST-GROUP-WINS-2', why: 'the same with the groups the other way round (1x1x2)',
    edits: [['const n = g.pitchedAt(b); if (n > best)', 'const n = 1; if (n > best)']], scenario: 'systemsReversed' },
  { id: 'MUT-GHOST-KEPT', why: 'a part of rests is kept as a group: the bar nobody plays is taken from it, with its own (wrong) time signature',
    edits: [['const real = groups.filter(g => g.pitched > 0);', 'const real = groups;']], scenario: 'ghost' },
  { id: 'MUT-TRIO-MERGED', why: 'parts that play in the same bars are merged as if they were one piano: the smaller group\'s notes are dropped',
    edits: [['if (shared > OVERLAP_MAX * active) {', 'if (false) {']], scenario: 'trio' },
  { id: 'MUT-OVERLAP-UNCOUNTED', why: 'the notes dropped where two groups share a bar are not counted',
    edits: [['ctx.counts.droppedNotes += holders.filter(g => g !== pick).reduce((s, g) => s + g.pitchedAt(b), 0);', '']], probe: dropped, clean: '1/1' },
  { id: 'MUT-FOLD-ANY-CLEFS', why: 'systems are folded whatever their clefs are: four treble systems become two grand staves',
    edits: [["if (!ca || !cb || ca.s.split('|')[0] !== 'G' || cb.s.split('|')[0] !== 'F') return null;", 'if (!ca || !cb) return null;']], scenario: 'foldNot' },
  { id: 'MUT-FOLD-UNEVEN', why: 'systems of different lengths are folded (the longer one\'s extra bars are lost)',
    edits: [['if (a.to - a.from !== b.to - b.from) return null;', '']], scenario: 'foldUneven' },
  { id: 'MUT-NO-FOLD', why: 'the systems of a grand staff read as single staves are not folded: 16 bars where the page has 8',
    edits: [['if (use.length === 1 && use[0].kind === \'single\') {', 'if (false) {']], scenario: 'fold' },
  { id: 'MUT-TIME-NEVER-CHANGES', why: 'a time signature is written on the first bar only',
    edits: [['if (st.time && (first || !prev.time || prev.time.s !== st.time.s))', 'if (st.time && first)']], scenario: 'changes' },
  { id: 'MUT-KEY-EVERY-BAR', why: 'the key signature is written on every bar',
    edits: [['if (st.key && (first || !prev.key || prev.key.s !== st.key.s))', 'if (st.key)']], scenario: 'changes' },
  { id: 'MUT-BARCOUNT-SILENT', why: 'a page whose bar count differs from its layout\'s is not reported',
    edits: [["if (p.ok && typeof s === 'number' && s > 0 && s !== p.bars) {", "if (false) {"]], scenario: 'barCount' },
  { id: 'MUT-HELPER-OLD-FIELD', why: 'the helper\'s old one-file-a-page field is preferred to its movements',
    edits: [['if (Array.isArray(body.movements))', 'if (false)']], probe: helperPages, clean: '[["a","b"]]' },
  { id: 'MUT-HEADER-LOST', why: 'the first file\'s header (identification: the engine\'s name) is not carried over: the page no longer knows the notation came from the engine',
    edits: [["const header = movs[0].doc.root.kids.filter(k => k.name !== 'part-list' && k.name !== 'part').map(clone);", 'const header = [];']], probe: headerKept, clean: true },
  { id: 'MUT-WIDTH-LOST', why: 'the bar widths PdfLayer.apply reads are not carried over',
    edits: [["['width', 'implicit'].forEach(k =>", "['implicit'].forEach(k =>"]], probe: widthKept, clean: '90' }
];

test('MUT-NOOP: the control. A comment is added and nothing moves', () => {
  const M = mutant([['const VERSION = 1;', 'const VERSION = 1; /* a comment */']]);
  for (const name of Object.keys(S)) assert.deepEqual(probe(M, name), S[name].expect(), name);
});

test('the real module answers every scenario and probe the way the mutants are measured against', () => {
  for (const m of MUTATIONS) {
    if (m.scenario) assert.deepEqual(probe(L.N, m.scenario), S[m.scenario].expect(), m.id);
    else assert.deepEqual(m.probe(L.N), m.clean, m.id);
  }
});

for (const m of MUTATIONS) {
  test(m.id + ': ' + m.why, () => {
    const M = mutant(m.edits);
    let answer;
    try { answer = m.scenario ? probe(M, m.scenario) : m.probe(M); } catch (e) { answer = 'threw: ' + e.message; }
    const clean = m.scenario ? S[m.scenario].expect() : m.clean;
    assert.notDeepEqual(answer, clean, 'the mutant gives the real answer: the suite would not notice');
  });
}

test('every scenario is read by at least one mutation: no scenario is dead weight', () => {
  const used = new Set(MUTATIONS.map(m => m.scenario).filter(Boolean));
  assert.deepEqual(Object.keys(S).filter(n => !used.has(n)), []);
});
