'use strict';
/* Would the suite notice if omr/edit-ops.js or omr/editor.js got worse? (docs/GOALS/G12_OMR.md section 12, gate A4: mutation checks of the op wiring)

   A whole copy of the module with ONE line broken is loaded from a temp directory, so the real one is untouched; the scenarios (scenarios.js) that read it must say ok
   for the real module and not ok (or throw) for the mutant. A mutation whose anchor has drifted fails loudly (it must match exactly once); MUT-NOOP is the control (a
   comment: nothing moves). The wiring ones are the kind of defect the review is after: an edit that goes round the validator, an edit that is not undone, an edit that
   does not say it was made by a person. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib.js');
const { S } = require('./scenarios.js');

const OPS_SRC = path.join(L.REPO, 'omr', 'edit-ops.js');
const ED_SRC = path.join(L.REPO, 'omr', 'editor.js');
const read = f => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
const roots = [];
let counter = 0;
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));
const REAL = { OPS: require(OPS_SRC), ED: require(ED_SRC) };
const SG_INDEX = JSON.stringify(path.join(L.REPO, 'scoregraph', 'index.js'));

function mutate(srcFile, edits) {
  let text = read(srcFile);
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 90)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-editor-mutant-' + (++counter) + '-'));
  roots.push(dir);
  text = text.replace("require('../scoregraph/index.js')", () => 'require(' + SG_INDEX + ')');
  const file = path.join(dir, path.basename(srcFile));
  if (srcFile === ED_SRC) text = text.replace("require('./edit-ops.js')", () => 'require(' + JSON.stringify(OPS_SRC) + ')');
  fs.writeFileSync(file, text);
  return require(file);
}
const sees = (mods, name) => { try { return !S[name].run(mods).ok; } catch (e) { return true; } };

/* the real modules are what the scenarios describe */
Object.keys(S).forEach(name => {
  test('the real modules satisfy: ' + name, () => {
    const r = S[name].run(REAL);
    assert.ok(r.ok, S[name].why + ' - ' + r.why);
  });
});

const OPS_MUTATIONS = [
  { id: 'MUT-STEP-DIRECTION', why: 'a step up goes down', edits: [["h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? -1 : 1), 0);", "h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? 1 : -1), 0);"]], scenarios: ['stepUp', 'stepDown'] },
  { id: 'MUT-OCTAVE-SIX', why: 'an octave is six steps', edits: [["h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? -7 : 7), 0);", "h.pitch = pitchAt(dposOf(h.pitch) + (args.by < 0 ? -6 : 6), 0);"]], scenarios: ['octaveUp'] },
  { id: 'MUT-RECONCILE-OFF', why: 'a note that relied on an accidental is not read again', edits: [["if (before.get(x.h.id) === true && alterOf(x.h) !== x.implied && setAlter(d, x, x.implied)) { changed.push(x.h.id); d.touch(); }", "void 0;"]], scenarios: ['accidentalCarry', 'keyReadsAgain', 'clefReadsAgain', 'accidentalNotOctaves'] },
  { id: 'MUT-RECONCILE-ALL', why: 'every note is read again, also one whose sound already disagreed with its notation', edits: [["if (before.get(x.h.id) === true && alterOf(x.h) !== x.implied && setAlter(d, x, x.implied))", "if (alterOf(x.h) !== x.implied && setAlter(d, x, x.implied))"]], scenarios: ['aloneInconsistent'] },
  { id: 'MUT-CARRY-ACROSS-OCTAVES', why: 'an accidental holds on every octave of its letter', edits: [["const p = x.h.pitch, k = p.step + '|' + p.oct;", "const p = x.h.pitch, k = p.step + '|' + 0;"]], scenarios: ['accidentalNotOctaves'] },
  { id: 'MUT-CARRY-NEVER', why: 'an accidental printed earlier in the bar is forgotten', edits: [["      else if (carry.has(k)) implied = carry.get(k);\n", "      else if (false) implied = carry.get(k);\n"]], scenarios: ['accidentalCarry', 'accidentalNotOctaves'] },
  { id: 'MUT-KEY-SIGN', why: 'a sharp key flattens', edits: [["    if (fifths > 0) return SHARPS.indexOf(step) < fifths ? 1 : 0;", "    if (fifths > 0) return SHARPS.indexOf(step) < fifths ? -1 : 0;"]], scenarios: ['keyReadsAgain', 'addUsesKey'] },
  { id: 'MUT-CLEF-WRONG-WAY', why: 'the pitch moves by the clef difference the other way', edits: [["const delta = clefBottom(now) - clefBottom(was);", "const delta = clefBottom(was) - clefBottom(now);"]], scenarios: ['clefReadsAgain'] },
  { id: 'MUT-CHAIN-NOT-SYNCED', why: 'the end of a tie is left where it was', edits: [["      syncChains(d, [anchor.h.id]);\n", ""]], scenarios: ['tieChain'] },
  { id: 'MUT-HALVE-NO-REST', why: 'a shorter note leaves a gap and no rest', edits: [["    const ids = d.retimeVoiceMeasure(voice, m, plan);\n    refill(d, voice, m);\n    return ids;", "    const ids = d.retimeVoiceMeasure(voice, m, plan);\n    return ids;"]], scenarios: ['halveFills', 'addInRest'] },
  { id: 'MUT-NO-ROOM-CHECK', why: 'a note is made longer into the next one (the validator is what refuses it)', edits: [["      if (others.some(o => overlaps({ s: at, e: end }, { s: atOf(o), e: endOf(o) }))) fail('no-room', 'a note follows');", "      void others;"]], scenarios: ['doubleNeedsRoom'] },
  { id: 'MUT-NO-VALIDATION', why: 'the result of an edit is not validated (the guard of the op alone stands)', edits: [["      }, { source: SOURCE });\n    } catch (e) {\n      if (e instanceof EditError) throw e;", "      }, { source: SOURCE, validate: false });\n    } catch (e) {\n      if (e instanceof EditError) throw e;"]], scenarios: ['refusesBrokenGraph'] },
  { id: 'MUT-TOO-SHORT', why: 'nothing stops at a 64th', edits: [["        if (R.lt(nl, SHORTEST)) fail('too-short', 'shorter than a 64th');", "        void SHORTEST;"]], scenarios: ['shortest'] },
  { id: 'MUT-TUPLET-ALLOWED', why: 'a note of a tuplet is rewritten', edits: [["    if (inTuplet(d, e)) fail('in-tuplet', 'the note is in a tuplet');\n  };", "    void inTuplet;\n  };"]], scenarios: ['tupletRefused'] },
  { id: 'MUT-DOT-WRONG', why: 'a dot makes a note twice as long', edits: [["        else nl = R.mul(base, R.make(3, 2));", "        else nl = R.mul(base, R.make(2, 1));"]], scenarios: ['dotted'] },
  { id: 'MUT-REST-TO-C4', why: 'a rest made a note takes a fixed pitch and not the staff\'s', edits: [["    if (best) { const h = best.heads.find(y => y.pitch); if (h) return { step: h.pitch.step, oct: h.pitch.oct }; }", "    void best;"]], scenarios: ['toNoteTakesNeighbour'] },
  { id: 'MUT-REMOVE-WHOLE-CHORD', why: 'deleting one head of a chord deletes the chord', edits: [["  function remove(g, args) { return args.head ? removeHead(g, args) : toRest(g, args); }", "  function remove(g, args) { return toRest(g, args); }"]], scenarios: ['removeHead'] },
  { id: 'MUT-ADD-OVER-NOTE', why: 'a note is put on a note of the same pitch', edits: [["          if (same.heads.some(h => h.pitch && midiOf(h.pitch) === midiOf(pitch) && h.pitch.step === pitch.step)) fail('occupied', 'the note is there');", "          void same;"]], scenarios: ['addOccupied'] },
  { id: 'MUT-ADD-NO-KEY', why: 'a new note ignores the key', edits: [["    const alter = w && w.implied !== undefined ? w.implied : 0;\n    nh.pitch = alter ?", "    const alter = 0;\n    void w;\n    nh.pitch = alter ?"]], scenarios: ['addUsesKey'] },
  { id: 'MUT-TIME-CUTS', why: 'a time signature that cuts a note is made', edits: [["        if (R.gt(e.grace ? R.parse(e.at) : endOf(e), nd)) fail('would-cut', 'a note would be cut', { event: e.id, measure: e.m });", "        void nd;"]], scenarios: ['timeCuts'] },
  { id: 'MUT-TIME-BARS-KEPT', why: 'the bars keep their old length', edits: [["      plan.forEach(x => { if (!R.eq(R.parse(x.m.dur), x.dur)) { x.m.dur = R.format(x.dur); x.m.prov = d.provRefOf({ source: SOURCE, op: 'edited' }); } });", "      void plan;"]], scenarios: ['timeBars'] },
  { id: 'MUT-INSERT-NOT-NUMBERED', why: 'the bars after an inserted bar keep their numbers', edits: [["      else renumber(d, at);\n      newBarRests(d, nid);", "      newBarRests(d, nid);"]], scenarios: ['insertBarRests'] },
  { id: 'MUT-INSERT-EMPTY', why: 'an inserted bar has nothing in it', edits: [["      newBarRests(d, nid);\n      d.touch();", "      d.touch();"]], scenarios: ['insertBarRests', 'insertBeforeFirst'], any: true },
  { id: 'MUT-INSERT-KEEPS-TIES', why: 'a tie that crossed the new bar is left', edits: [["      dropTiesAcross(d, at);\n      if (at === 0) {", "      if (at === 0) {"]], scenarios: ['insertEndsTies'] },
  { id: 'MUT-INSERT-START-STAYS', why: 'a bar before the first leaves the time signature on the old first bar', edits: [["        tl.meters.forEach(x => { if (x.m === first) x.m = nid; });\n", ""]], scenarios: ['insertBeforeFirst'] },
  { id: 'MUT-DELETE-KEEPS-EVENTS', why: 'a deleted bar leaves its notes in the score', edits: [["      d.removeEvents(evIds);\n      d.doc.parts.forEach(part => {\n        part.directions = part.directions.filter(x => { if (x.m === m.id)", "      void evIds;\n      d.doc.parts.forEach(part => {\n        part.directions = part.directions.filter(x => { if (x.m === m.id)"]], scenarios: ['deleteBar'] },
  { id: 'MUT-DELETE-LOSES-START', why: 'the first bar takes the time signature with it', edits: [["        if (next && !tl.meters.some(o => o !== x && o.m === next.id)) { x.m = next.id; return true; }\n        d.retire(x.id); return false;", "        d.retire(x.id); return false;"]], scenarios: ['deleteFirstBar'] },
  { id: 'MUT-DELETE-ONLY-BAR', why: 'the only bar is deleted', edits: [["      if (ms.length <= 1) fail('last-bar', 'the only bar');", "      void 0;"]], scenarios: ['deleteOnlyBar'] },
  { id: 'MUT-SPLIT-NO-CUT', why: 'a note across the place is not cut', edits: [["      across.forEach(e => {\n        if (inTuplet(d, e)) fail('in-tuplet', 'a tuplet crosses the place');", "      across.length = 0;\n      across.forEach(e => {\n        if (inTuplet(d, e)) fail('in-tuplet', 'a tuplet crosses the place');"]], scenarios: ['splitCutsNote'] },
  { id: 'MUT-SPLIT-NOT-SHIFTED', why: 'what moves to the new bar keeps its place in the old', edits: [["          if (R.ge(R.parse(e.at), at)) { e.m = nid; e.at = R.format(R.sub(R.parse(e.at), at)); }", "          if (R.ge(R.parse(e.at), at)) { e.m = nid; }"]], scenarios: ['splitMovesLate'] },
  { id: 'MUT-MERGE-NOT-SHIFTED', why: 'the second bar\'s notes stay at their own places in the joined bar', edits: [["          e.m = a.id; e.at = shift(e.at);", "          e.m = a.id;"]], scenarios: ['mergeShifts'] },
  { id: 'MUT-MERGE-METERS', why: 'bars of different time signatures are joined', edits: [["      if (meterB && meterA && !(sameJson(meterB.beats, meterA.beats) && meterB.beatType === meterA.beatType)) fail('meter-differs', 'different time signatures');", "      void 0;"]], scenarios: ['mergeMeters'] },
  { id: 'MUT-PARTS-NO-STAVES', why: 'merging two parts leaves the staves of the second out', edits: [["      A.staves = A.staves.concat(B.staves);\n", ""]], scenarios: ['mergeParts'] },
  { id: 'MUT-NOT-EDITED', why: 'a head an edit changed says nothing of who changed it', edits: [["    d.markProv(x.h, ['pitch'], 'edited');\n    return true;\n  }", "    return true;\n  }"], ["      d.markProv(anchor.h, ['pitch'], 'edited');\n      if (!sameAcc(wasAcc", "      if (!sameAcc(wasAcc"]], scenarios: ['provenance'] },
  { id: 'MUT-EDITED-AS-GENERATED', why: 'an edit says op generated', edits: [["      d.markProv(anchor.h, ['pitch'], 'edited');\n      if (!sameAcc(wasAcc", "      d.markProv(anchor.h, ['pitch'], 'generated');\n      if (!sameAcc(wasAcc"], ["    d.markProv(x.h, ['pitch'], 'edited');\n    return true;\n  }", "    d.markProv(x.h, ['pitch'], 'generated');\n    return true;\n  }"]], scenarios: ['provenance'] },
  { id: 'MUT-REVIEWED-STAYS', why: 'an edit of a bar leaves the mark that it was right', edits: [["        if (d.changed) { clearReviewed(d, touched); }", "        void clearReviewed;"]], scenarios: ['reviewedCleared'] },
  { id: 'MUT-REVIEWED-ALWAYS-CLEARED', why: 'every edit takes every reviewed mark off', edits: [["    const keep = fl.filter(f => !(f.kind === 'review' && f.code === 'reviewed' && f.ids && f.ids.length && f.ids.every(x => ids.has(x))));", "    const keep = fl.filter(f => !(f.kind === 'review' && f.code === 'reviewed'));"]], scenarios: ['reviewedCleared'] }
];
const ED_MUTATIONS = [
  { id: 'MUT-UNDO-NO-STEP', why: 'an edit is not kept for undo', edits: [["      states.push({ graph: res.graph, focus: focus || null, label: label || '' });", "      void focus;"]], scenarios: ['sessionUndo', 'sessionRedoDies', 'sessionDiscard'] },
  { id: 'MUT-UNDO-WRONG-STATE', why: 'an undo goes two steps back', edits: [["        const was = cur();\n        pos--;", "        const was = cur();\n        pos = Math.max(0, pos - 2);"]], scenarios: ['sessionUndo'] },
  { id: 'MUT-REDO-KEPT', why: 'a new edit after an undo leaves the old redo steps', edits: [["      states.length = pos + 1;\n", ""]], scenarios: ['sessionRedoDies'] },
  { id: 'MUT-REFUSAL-STEP', why: 'a refused edit makes a step', edits: [["          if (e && e.name === 'EditError') return { ok: false, code: e.code, message: e.message, detail: e.detail || null };", "          if (e && e.name === 'EditError') { after({ graph: cur().graph }, null, 'x'); return { ok: false, code: e.code, message: e.message, detail: e.detail || null }; }"]], scenarios: ['sessionRefusalNoStep'] },
  { id: 'MUT-NO-LIMIT', why: 'the stack grows without end', edits: [["      if (states.length > limit + 1) states.splice(0, states.length - (limit + 1));", "      void limit;"]], scenarios: ['sessionLimit'] },
  { id: 'MUT-DISCARD-NO-STEP', why: 'discard cannot be undone', edits: [["        after({ graph: base }, null, 'discard');", "        states.length = 1; pos = 0; checkCache = null;"]], scenarios: ['sessionDiscard'] },
  { id: 'MUT-FLAGS-BY-INDEX', why: 'what the import said about a bar stays at its number when bars are put in before it', edits: [["        g.timeline.measures.forEach((m, i) => { if (importFlags[m.id]) flags[i + 1] = importFlags[m.id]; });", "        Object.keys(nf).forEach(k => { flags[k] = nf[k]; });"]], scenarios: ['sessionFlagsByBarId'] },
  { id: 'MUT-REVIEWED-COUNTED', why: 'a bar marked right is still a suspect bar of the report', edits: [["        if (reviewedNo.size) {\n          fresh.issues", "        if (false) {\n          fresh.issues"], ["res.bars.map((b, i) => (reviewedNo.has(numbers[i]) ? Object.assign({}, b, { suspect: false, strong: [], weak: [], reasons: [] }) : b))", "res.bars"]], scenarios: ['sessionReportReviewed'] },
  { id: 'MUT-FILL-OK', why: 'every bar is said to be full', edits: [["        const bad = !R.eq(sum, need);", "        const bad = false;"]], scenarios: ['sessionFill'] },
  { id: 'MUT-WINDOW-NO-KEY', why: 'a bar drawn alone has no key signature', edits: [["    byScope.forEach(k => { const x = clone(k); x.m = measureId; x.at = '0'; doc.timeline.keys.push(x); });", "    void byScope;"]], scenarios: ['sessionWindow'] },
  { id: 'MUT-DESCRIBE-DOUBLE', why: 'the toolbar offers a longer note where a note follows', edits: [["      valueOk.double = R.le(R.add(s, d2), mdur) && !!EO.displayFor(d2) && free(R.add(s, d2));", "      valueOk.double = true;"]], scenarios: ['sessionDescribe'] }
];

test('control: a mutation that changes nothing is not seen', () => {
  const m = mutate(OPS_SRC, [["  const VERSION = 1;", "  const VERSION = 1; /* control */"]]);
  Object.keys(S).filter(n => !/^session/.test(n)).forEach(n => assert.equal(sees({ OPS: m, ED: REAL.ED }, n), false, n));
});
OPS_MUTATIONS.forEach(m => {
  test(m.id + ': ' + m.why, () => {
    const mod = mutate(OPS_SRC, m.edits);
    const mods = { OPS: mod, ED: REAL.ED };
    const seen = m.scenarios.filter(n => sees(mods, n));
    if (m.notAll) assert.ok(seen.length >= 1, m.id + ' is seen by none of ' + m.scenarios.join(', '));
    else if (m.any) assert.ok(seen.length >= 1, m.id + ' is seen by none of ' + m.scenarios.join(', '));
    else assert.deepEqual(seen, m.scenarios, m.id + ' is not seen by ' + m.scenarios.filter(n => seen.indexOf(n) < 0).join(', '));
  });
});
ED_MUTATIONS.forEach(m => {
  test(m.id + ': ' + m.why, () => {
    const mod = mutate(ED_SRC, m.edits);
    const mods = { OPS: REAL.OPS, ED: mod };
    const seen = m.scenarios.filter(n => sees(mods, n));
    assert.ok(seen.length >= 1, m.id + ' is seen by none of ' + m.scenarios.join(', '));
  });
});
