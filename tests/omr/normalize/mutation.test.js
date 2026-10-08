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
const deepAnswer = Nn => {
  const bomb = doc([part('P1', [SC.grandBar(0, SC.grandFirst({ lead: '<foo>'.repeat(20000) + '</foo>'.repeat(20000) })), SC.grandBar(1)], { div: 2, staved: true })]);
  try { const r = Nn.normalize([bomb]); return r.ok + '/' + r.error; } catch (e) { return 'threw'; }
};
const dropped = Nn => {
  const grand = part('P1', [SC.grandBar(0, SC.grandFirst()), SC.grandBar(1), SC.grandBar(2), SC.grandBar(3)], { div: 2, staved: true });
  const junk = part('P2', [SC.restBar(SC.first({ clefs: ['G'] })), SC.restBar(), SC.restBar(), { items: [note('C6', 4, { type: 'whole' })] }], { div: 2 });
  const r = Nn.normalize([doc([grand, junk])]);
  return r.report.counts.droppedNotes + '/' + r.report.counts.overlapBars;
};

/* G12-2: a direction that holds a dynamic and a wedge keeps the dynamic */
const dynamicKept = Nn => {
  const both = '<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><direction-type><wedge type="diminuendo" spread="0"/></direction-type><staff>1</staff></direction>';
  const x = doc([part('P1', [SC.grandWith(0, { 1: [SC.wedge('crescendo')], 2: [L.raw(both), SC.wedge('stop')], 3: [SC.wedge('stop')] }, SC.grandFirst()), SC.grandBar(1)], { div: 2, staved: true })]);
  return /<dynamics><p\/><\/dynamics>/.test(Nn.normalize([x]).xml);
};
/* a column whose only wedge problem is an unclosed mark is not touched */
const loneKept = Nn => SC.wedgesOf(Nn.normalize([doc([part('P1', [SC.grandWith(0, { 1: [SC.wedge('crescendo')] }, SC.grandFirst()), SC.grandBar(1)], { div: 2, staved: true })])]).xml);
/* a pitched zero-length note with a plain type is repaired, one with a dot is left */
const pitchedZero = Nn => {
  const one = (extra) => doc([part('P1', [{ items: [note('C5', 1, { s: 1 }), note('D5', 0, Object.assign({ s: 1, type: 'quarter' }, extra)), note('E5', 1, { s: 1 })], staved: true, div: 2, key: 0, time: [4, 4], staves: 1, clefs: ['G'] }], { div: 2, staved: true })]);
  const a = Nn.normalize([one()]), b = Nn.normalize([one({ dot: true })]);
  return [a.report.counts.zeroNotesRepaired, a.report.counts.zeroRestsRepaired, a.report.counts.zeroDurationsLeft, b.report.counts.zeroNotesRepaired, b.report.counts.zeroNotesLeft].join();
};

/* id, the mutation, the scenario that must see it (or a probe and what the real module answers) */
const MUTATIONS = [
  { id: 'MUT-ZERO-UNREPAIRED', why: 'a note of length 0 is found and counted but not given a length: the importer refuses the file (E-DURATION)',
    edits: [["      d.text = String(len);\n      fx.repaired++;", "      fx.repaired++;"]], scenario: 'zeroRest', also: ['zeroRestPair', 'zeroRestCompound', 'zeroRestTyped'] },
  { id: 'MUT-ZERO-BAR-IN-QUARTERS', why: 'the length of a whole-bar rest ignores the beat type: a bar of 6/8 lasts six quarters',
    edits: [["const len = (beats * 4 / bt) * dOut;", "const len = beats * dOut;"]], scenario: 'zeroRestCompound' },
  { id: 'MUT-ZERO-TYPE-IGNORED', why: 'a zero-length note that is no whole-bar rest is not read from its type',
    edits: [["if (ty && TYPE_Q[ty] && !kid(c, 'dot') && !kid(c, 'time-modification') && !kid(c, 'grace')) {", "if (false) {"]], scenario: 'zeroRestTyped' },
  { id: 'MUT-ZERO-DOTTED-GUESSED', why: 'a dotted note of length 0 is read as if it were not dotted (a length the page does not give)',
    edits: [["if (ty && TYPE_Q[ty] && !kid(c, 'dot') && !kid(c, 'time-modification') && !kid(c, 'grace')) {", "if (ty && TYPE_Q[ty] && !kid(c, 'grace')) {"]], probe: pitchedZero, clean: '1,0,0,0,1' },
  { id: 'MUT-ZERO-SPLIT-SWAPPED', why: 'a repaired pitched note is counted as a rest (and a rest as a note)',
    edits: [["if (r) fx.rests++; else fx.notes++;", "if (r) fx.notes++; else fx.rests++;"]], scenario: 'zeroRest', also: ['zeroRestCompound'] },
  { id: 'MUT-ZERO-LEFT-SPLIT-SWAPPED', why: 'a zero length left is counted under the wrong kind',
    edits: [["fx.left++; if (r) fx.leftRests++; else fx.leftNotes++;", "fx.left++; if (r) fx.leftNotes++; else fx.leftRests++;"]], scenario: 'zeroRestLeft' },
  { id: 'MUT-ZERO-NO-BACKUP', why: 'a repaired whole-bar rest gets its length and no <backup>: the rest of the other staff starts where it ends and the bar is twice as long (every later bar plays a bar late)',
    edits: [["        body.splice(at + 1, 0, mk('backup', {}, [mk('duration', {}, String(r.len))]));\n        fx.backups++;", "        fx.backups++;"]], scenario: 'zeroRest', also: ['zeroRestCompound'] },
  { id: 'MUT-ZERO-BACKUP-WRONG-LENGTH', why: 'the <backup> after a repaired rest goes back by one division, not by the length of the rest',
    edits: [["mk('backup', {}, [mk('duration', {}, String(r.len))])", "mk('backup', {}, [mk('duration', {}, '1')])"]], scenario: 'zeroRest', also: ['zeroRestCompound'] },
  { id: 'MUT-ZERO-BACKUP-ALWAYS', why: 'a <backup> is written after every repaired whole-bar rest, also when nothing follows it',
    edits: [["if (later.some(e => e.name === 'note' || e.name === 'forward')) {", "if (true) {"]], scenario: 'zeroRestPair', also: ['zeroRest', 'zeroRestCompound'] },
  { id: 'MUT-ZERO-OWN-VOICE-REPAIRED', why: 'a whole-bar rest of length 0 followed by a note of its own voice is given the bar (it plays with the note)',
    edits: [["if (later.some(e => e.name === 'note' && key(e) === key(r.el))) {", "if (false) {"]], scenario: 'zeroRestOwnVoice' },
  { id: 'MUT-ZERO-OWN-VOICE-ANY-VOICE', why: 'a note of ANY voice after the rest withdraws the repair (the other staff\'s rest too)',
    edits: [["if (later.some(e => e.name === 'note' && key(e) === key(r.el))) {", "if (later.some(e => e.name === 'note')) {"]], scenario: 'zeroRest', also: ['zeroRestCompound'] },
  { id: 'MUT-ZERO-REFUSED-UNCOUNTED', why: 'a repair withdrawn is not counted as left or as refused',
    edits: [["fx.repaired--; fx.rests--; fx.left++; fx.leftRests++; fx.refused++;", "fx.repaired--; fx.rests--;"]], scenario: 'zeroRestOwnVoice' },
  { id: 'MUT-ZERO-GUESSED', why: 'a zero length with nothing to read it from is given one division and not reported as left',
    edits: [["    } else { fx.left++; if (r) fx.leftRests++; else fx.leftNotes++; }", "    } else { d.text = '1'; fx.repaired++; fx.rests++; }"]], scenario: 'zeroRestLeft' },
  { id: 'MUT-ZERO-REPAIRS-UNCOUNTED', why: 'the repairs are made but not counted',
    edits: [["ctx.counts.zeroDurationsRepaired += fx.repaired;", "ctx.counts.zeroDurationsRepaired += 0;"]], scenario: 'zeroRest', also: ['zeroRestPair', 'zeroRestCompound', 'zeroRestTyped'] },
  { id: 'MUT-ZERO-LEFT-UNCOUNTED', why: 'a zero length that is left is not counted: the import will refuse and nobody can say why',
    edits: [["ctx.counts.zeroDurationsLeft += fx.left;", "ctx.counts.zeroDurationsLeft += 0;"]], scenario: 'zeroRestLeft' },
  { id: 'MUT-ZERO-UNFLAGGED', why: 'the bar of a repaired or left zero length carries no flag',
    edits: [["        flagFixes(bo);\n", "\n"]], scenario: 'zeroRest', also: ['zeroRestLeft'] },
  { id: 'MUT-ZERO-LOWER-PART-LOST', why: 'the repairs in the lower part of a pair are not added to the bar\'s',
    edits: [["fixes: addFixes(addFixes(newFixes(), upper && upper.fixes), lower && lower.fixes),", "fixes: addFixes(newFixes(), upper && upper.fixes),"]], scenario: 'zeroRestPair' },
  { id: 'MUT-WEDGE-NEVER-DROPPED', why: 'the hairpins that end where they start are left in the file: the importer refuses it (E-SPAN-ORDER)',
    edits: [["    if (!degenerate) return;", "    return;"]], scenario: 'wedges', also: ['wedgesNumbered', 'wedgesAcrossBars', 'wedgesOffset'] },
  { id: 'MUT-WEDGE-TOUCHES-CLEAN-COLUMN', why: 'a column with no degenerate pair is cleaned too (an unclosed mark the importer would drop itself)',
    edits: [["    if (!degenerate) return;", "    if (!degenerate && !open.size) return;"]], probe: loneKept, clean: 'crescendo | ' },
  { id: 'MUT-WEDGE-EQUAL-IS-FINE', why: 'a stop at the very place of its start is taken for a wedge of positive length',
    edits: [["(bi === st.bar && at <= st.at)", "(bi === st.bar && at < st.at)"]], scenario: 'wedges', also: ['wedgesNumbered', 'wedgesAcrossBars'] },
  { id: 'MUT-WEDGE-IGNORES-NUMBER', why: 'the number of a wedge is ignored: every wedge pairs with the open one, whatever its number',
    edits: [["const type = w.attrs.type, no = w.attrs.number || '1';", "const type = w.attrs.type, no = '1';"]], scenario: 'wedgesNumbered' },
  { id: 'MUT-WEDGE-BY-PLACE-ONLY', why: 'a stop in a later bar is judged by its place in the bar alone: a hairpin across a bar line is taken for one that ends before it starts',
    edits: [["if (bi < st.bar || (bi === st.bar && at <= st.at))", "if (at <= st.at)"]], scenario: 'wedgesAcrossBars' },
  { id: 'MUT-WEDGE-OFFSET-IGNORED', why: 'the <offset> of a direction is not added to its place: a stop put after its start by an offset is taken for one at the same place',
    edits: [["const at = cur + (num(textOf(e, 'offset')) || 0);\n          kidsOf(e, 'direction-type')", "const at = cur;\n          kidsOf(e, 'direction-type')"]], scenario: 'wedgesOffset' },
  { id: 'MUT-WEDGE-RESTART-KEPT', why: 'a start while a wedge is open leaves the open one in the file: after the degenerate pair is taken away it pairs with a later stop, a mark the page does not show',
    edits: [["              if (prev) mark(prev.ref.w, prev.ref);\n", "\n"]], scenario: 'wedges' },
  { id: 'MUT-WEDGE-UNPAIRED-STOP-KEPT', why: 'a stop with no start is left in the file',
    edits: [["if (!st) { mark(w, ref); return; }", "if (!st) return;"]], scenario: 'wedges' },
  { id: 'MUT-WEDGE-UNCLOSED-KEPT', why: 'a start that never stops is left in the file',
    edits: [["    open.forEach(st => mark(st.ref.w, st.ref));\n", "\n"]], scenario: 'wedgesAcrossBars' },
  { id: 'MUT-WEDGE-EMPTY-DIRECTION-LEFT', why: 'the wedge goes but its direction stays, empty (invalid MusicXML)',
    edits: [["      if (!ref.dir.kids.some(k => k.name === 'direction-type')) ref.bo.body = ref.bo.body.filter(k => k !== ref.dir);\n", "\n"]], scenario: 'wedges' },
  { id: 'MUT-WEDGE-WHOLE-DIRECTION', why: 'the whole direction goes with its wedge, the dynamic mark in it too',
    edits: [["      ref.dt.kids = ref.dt.kids.filter(k => k !== ref.w);\n      if (!ref.dt.kids.length) ref.dir.kids = ref.dir.kids.filter(k => k !== ref.dt);\n      if (!ref.dir.kids.some(k => k.name === 'direction-type')) ref.bo.body = ref.bo.body.filter(k => k !== ref.dir);",
      "      ref.bo.body = ref.bo.body.filter(k => k !== ref.dir);"]], probe: dynamicKept, clean: true },
  { id: 'MUT-WEDGE-UNFLAGGED', why: 'the bar a wedge was taken from carries no flag',
    edits: [["      if (ref.bo.flags.indexOf('wedge-dropped') < 0) ref.bo.flags.push('wedge-dropped');\n", "\n"]], scenario: 'wedges' },
  { id: 'MUT-WEDGE-UNCOUNTED', why: 'the wedges taken away are not counted',
    edits: [["ctx.counts.wedgesDropped += bad.size;", "ctx.counts.wedgesDropped += 0;"]], scenario: 'wedges' },

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
  { id: 'MUT-CURSOR-COUNTS-CHORD', why: 'a chord note counts as a note that takes time when the <backup> to the lower staff is worked out: the lower staff starts a quarter early (the reviewer mutant)',
    edits: [["if (!kid(e, 'chord') && !kid(e, 'grace')) return num(textOf(e, 'duration')) || 0;", "if (!kid(e, 'grace')) return num(textOf(e, 'duration')) || 0;"]], scenario: 'pairRich', also: ['systemsRich', 'foldRich'] },
  { id: 'MUT-CURSOR-IGNORES-FORWARD', why: 'a <forward> does not move the end of the upper staff when the <backup> is worked out: the lower staff starts late',
    edits: [["else if (e.name === 'forward') return num(textOf(e, 'duration')) || 0;", ""]], scenario: 'pairRich', also: ['systemsRich', 'foldRich'] },
  { id: 'MUT-CURSOR-IGNORES-BACKUP', why: 'a <backup> in the upper staff (its second voice) is not subtracted: the lower staff starts after the bar',
    edits: [["else if (e.name === 'backup') return -(num(textOf(e, 'duration')) || 0);", ""]], scenario: 'pairRich', also: ['systemsRich', 'foldRich'] },
  { id: 'MUT-FORWARD-UNSCALED', why: 'a <forward> is not scaled to the divisions of the document with the notes and backups: the second voice starts at the wrong beat',
    edits: [['        content = true;\n        scaleDur(c);', "        content = true;\n        if (n !== 'forward') scaleDur(c);"]], scenario: 'pagesRich' },
  { id: 'MUT-TIE-LOST', why: 'the <tie> elements of a note are dropped when it is copied: a tied pair is struck twice',
    edits: [["kids: el.kids.map(clone), text: el.text }; }", "kids: el.kids.filter(k => k.name !== 'tie').map(clone), text: el.text }; }"]], scenario: 'pairRich', also: ['systemsRich', 'foldRich', 'pagesRich'] },
  { id: 'MUT-GRACE-LOST', why: 'a grace note is dropped when a bar is copied',
    edits: [["      const c = clone(e);\n      if (n === 'note' || n === 'backup' || n === 'forward') {", "      if (n === 'note' && kid(e, 'grace')) return;\n      const c = clone(e);\n      if (n === 'note' || n === 'backup' || n === 'forward') {"]], scenario: 'systemsRich', also: ['pairRich', 'foldRich', 'pagesRich'] },
  { id: 'MUT-NORMALIZE-THROWS', why: 'normalize() lets an exception out (a document nested 20,000 deep overflows the stack): the page would have to catch it',
    edits: [["try { return normalizePages(pagesIn, opts); } catch (e) {", "try { return normalizePages(pagesIn, opts); } catch (e) { throw e;"]], probe: deepAnswer, clean: 'false/internal-error' },
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
  const M = mutant([['const VERSION = 2;', 'const VERSION = 2; /* a comment */']]);
  for (const name of Object.keys(S)) assert.deepEqual(probe(M, name), S[name].expect(), name);
});

test('the real module answers every scenario and probe the way the mutants are measured against', () => {
  for (const m of MUTATIONS) {
    if (m.scenario) [m.scenario].concat(m.also || []).forEach(sc => assert.deepEqual(probe(L.N, sc), S[sc].expect(), m.id + ' ' + sc));
    else assert.deepEqual(m.probe(L.N), m.clean, m.id);
  }
});

for (const m of MUTATIONS) {
  test(m.id + ': ' + m.why, () => {
    const M = mutant(m.edits);
    const seen = [m.scenario].concat(m.also || []).filter(Boolean);
    const answers = (seen.length ? seen : [null]).map(sc => {
      try { return sc ? [probe(M, sc), S[sc].expect()] : [m.probe(M), m.clean]; } catch (e) { return ['threw: ' + e.message, 'a normal answer']; }
    });
    /* the named scenario must see it (that is what the mutant is for); the others are named only if they see it too */
    assert.notDeepEqual(answers[0][0], answers[0][1], 'the mutant gives the real answer: the suite would not notice');
    answers.slice(1).forEach((a, i) => assert.notDeepEqual(a[0], a[1], 'the scenario ' + seen[i + 1] + ' does not see this mutant'));
  });
}

test('every scenario is read by at least one mutation: no scenario is dead weight', () => {
  const used = new Set([].concat.apply([], MUTATIONS.map(m => [m.scenario].concat(m.also || []))).filter(Boolean));
  assert.deepEqual(Object.keys(S).filter(n => !used.has(n)), []);
});
