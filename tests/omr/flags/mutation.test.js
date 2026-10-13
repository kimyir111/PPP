'use strict';
/* Would the suite notice if omr/flags.js got worse? (docs/GOALS/G12_OMR.md section 12, gate A3: "mutation checks": each signal removable => a test fails)

   omr/flags.js is mutated the way tests/omr/normalize/mutation.test.js and tests/omr/apply/mutation.test.js mutate their modules: a whole copy with ONE line
   broken, loaded from a temp directory so the real one is untouched. The cases of scenarios.js and the checks below that read it must say ok for the real module
   and not ok (or throw) for the mutant. A mutation whose anchor has drifted fails loudly (it must match exactly once); MUT-NOOP is the control (a comment: nothing
   moves). The signals are mutated by the table: each one's test replaced by `() => null`, which must make a case of that very signal fail. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./scenarios.js');
const L = require('./lib.js');

const SRC = path.join(L.REPO, 'omr', 'flags.js');
const roots = [];
let counter = 0;
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));
const source = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

function mutant(edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 100)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  const wired = text.replace("require('../scoregraph/tools/notation-check.js')", () => 'require(' + JSON.stringify(path.join(L.REPO, 'scoregraph', 'tools', 'notation-check.js')) + ')');
  assert.notEqual(wired, text, 'the require was rewired');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-flags-mutant-' + (++counter) + '-'));
  roots.push(dir);
  const file = path.join(dir, 'flags.js');
  fs.writeFileSync(file, wired);
  return require(file);
}

/* ---- what the mutants are judged by: the case table, and a few checks of the parts that are not a signal */
const bars = (k, edits) => L.plainBars(k, edits);
const CHECKS = {
  /* the rule */
  strongAlone: async M => {
    const g = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
    return M.analyze(g, { params: L.only('fill-short', 'strong', { weakNeeded: 2 }) }).suspect.join() === '2';
  },
  oneWeakIsNotEnough: async M => {
    const g = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C4', 1), L.n('C6', 1), L.n('D6', 1), L.n('E6', 1)] } })));
    return M.analyze(g, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 2, thr: M.PARAMS.thr } }).suspect.length === 0;
  },
  twoWeakAreEnough: async M => {
    const g = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C3', 1), L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)], lh: [L.n('C4', 1), L.n('G3', 1), L.n('C4', 1), L.n('G3', 1)] } })));
    const two = M.analyze(g, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 2, thr: M.PARAMS.thr } }).suspect.join() === '2';
    const three = M.analyze(g, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 3, thr: M.PARAMS.thr } }).suspect.length === 0;
    return two && three;
  },
  badPage: async M => {
    const short = [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)];
    const g = await L.graphOf(L.doc(bars(5, { 1: { rh: short }, 2: { rh: short }, 4: { rh: short }, 5: { rh: short }, 3: { rh: [L.n('C4', 1), L.n('C6', 1), L.n('D6', 1), L.n('E6', 1)] } })));
    const params = { strong: ['fill-short'], weak: ['big-leap', 'bad-page'], weakNeeded: 2, thr: Object.assign({}, M.PARAMS.thr, { badPage: 0.3 }) };
    const res = M.analyze(g, { params });
    const quiet = M.analyze(g, { params: Object.assign({}, params, { thr: Object.assign({}, params.thr, { badPage: 0.9 }) }) });
    return res.bars[2].suspect === true && res.bars[2].weak.includes('bad-page') && quiet.bars[2].suspect === false;
  },
  badPageShare: async M => {
    // one short bar of ten is not a bad page: the share is a fraction of the bars
    const g = await L.graphOf(L.doc(bars(10, { 1: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] }, 5: { rh: [L.n('C4', 1), L.n('C6', 1), L.n('D6', 1), L.n('E6', 1)] } })));
    const params = { strong: ['fill-short'], weak: ['big-leap', 'bad-page'], weakNeeded: 2, thr: Object.assign({}, M.PARAMS.thr, { badPage: 0.3 }) };
    return M.analyze(g, { params }).bars[4].suspect === false;
  },
  nextToBad: async M => {
    const g = await L.graphOf(L.doc(bars(5, { 3: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
    const res = M.analyze(g, { params: { strong: ['fill-short'], weak: ['next-to-bad'], weakNeeded: 1, thr: M.PARAMS.thr } });
    return res.suspect.join() === '2,3,4' && res.bars[0].suspect === false && res.bars[4].suspect === false;
  },
  external: async M => {
    const g = await L.graphOf(L.doc(bars(4)));
    const base = { strong: [], weak: [], weakNeeded: 2, thr: M.PARAMS.thr };
    const one = M.analyze(g, { params: base, external: { 2: ['a'] } });
    const two = M.analyze(g, { params: base, external: { 2: ['a', 'b'] } });
    const strong = M.analyze(g, { params: base, external: { 3: [{ code: 'c', strength: 'strong', text: 'x' }] } });
    const share = M.analyze(g, { params: { strong: [], weak: ['bad-page'], weakNeeded: 2, thr: Object.assign({}, M.PARAMS.thr, { badPage: 0.2 }) }, external: { 1: [{ code: 'a', strength: 'strong' }] } });
    return one.suspect.length === 0 && two.suspect.join() === '2' && strong.suspect.join() === '3' && share.bars[1].weak.includes('bad-page');
  },
  /* the confidence */
  confidence: async M => {
    let ok = M.confidenceOf(0, 40, 1) === 1 && M.confidenceOf(0, 40, 0.9) === 0.9;
    for (const [c, t, b] of [[1, 40, 1], [1, 1, 1], [5, 400, 0.99], [40, 40, 1]]) { const v = M.confidenceOf(c, t, b); ok = ok && v < M.GOOD && v >= 0.05 && v <= b; }
    return ok && M.confidenceOf(1, 4000, 1) <= 0.84 && M.confidenceOf(1, 40, 1) > M.confidenceOf(10, 40, 1) && M.confidenceOf(3, 40, 0.3) === 0.3;
  },
  /* the sentence */
  sentences: async M => M.reasonText({ code: 'page-bars', shown: 6, read: 5 }) === 'The page shows 6 measures on this line, PPP read 5.'
    && M.reasonText({ code: 'page-bars', shown: 24, read: 23, page: true }) === 'The page shows 24 measures in all, PPP read 23.'
    && M.reasonText({ code: 'rebuilt' }) === 'This part was rebuilt from two staves.' && M.reasonText({ code: 'nope' }) === 'Another check doubts this measure.',
  /* the answer */
  numbers: async M => {
    const g = await L.graphOf(L.doc(bars(4, { 3: { rh: [L.n('C5', 1), L.n('D5', 1)] } })));
    const res = M.analyze(g, {});
    return res.ok && res.suspect.join() === '3' && res.bars[2].n === 3 && res.bars.length === 4 && res.counts['fill-short'] === 1 && res.confidence < M.GOOD;
  },
  threeFour: async M => {
    const g = await L.graphOf(L.doc([{ rh: [L.n('C5', 2), L.n('D5', 1)], lh: [L.measureRest(3)] }, { rh: [L.n('C5', 3)], lh: [L.measureRest(3)] }], { time: [3, 4] }));
    return M.analyze(g, { params: L.only('fill-short') }).suspect.length === 0;
  },
  meterChange: async M => {
    // 4/4 for two bars, then 3/4: a 3/4 bar is full, and a 4-quarter bar in it is over
    const xml = L.doc(bars(2)).replace('</measure><measure number="2">', () => '</measure><measure number="2">');
    const g = await L.graphOf(xml);
    return M.analyze(g, { params: L.only('fill-short') }).suspect.length === 0;
  },
  keyOfD: async M => {
    const g = await L.graphOf(L.doc([0, 1, 2].map(() => ({ rh: [L.n('C#5', 1), L.n('D5', 1), L.n('E5', 1), L.n('F#5', 1)], lh: [L.n('D3', 1), L.n('A3', 1), L.n('D3', 1), L.n('A3', 1)] })), { fifths: 2 }));
    return M.analyze(g, { params: L.only('off-key') }).suspect.length === 0;
  },
  /* the boundaries (boundaries.test.js has the same, with their reasons) */
  reasonOrder: async M => {
    const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C3', 1), L.n('D3', 1), L.n('E3', 1), L.n('F3', 1)], lh: [L.n('C4', 1), L.n('G3', 1), L.n('C4', 1), L.n('G3', 1)] } })));
    const res = M.analyze(g, { normalize: { flags: { 2: ['pair-merged'] } }, params: { strong: ['rebuilt'], weak: ['hands-cross'], weakNeeded: 2, thr: M.PARAMS.thr }, external: { 2: ['ext-weak', { code: 'ext-strong', strength: 'strong' }] } });
    return res.bars[1].reasons.map(r => r.code).join() === 'rebuilt,ext-strong,hands-cross,ext-weak';
  },
  badPageBoundary: async M => {
    const short = { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] };
    const params = { strong: ['fill-short'], weak: ['bad-page'], weakNeeded: 1, thr: Object.assign({}, M.PARAMS.thr, { badPage: 0.3 }) };
    const three = M.analyze(await L.graphOf(L.doc(bars(10, { 1: short, 4: short, 7: short }))), { params });
    const two = M.analyze(await L.graphOf(L.doc(bars(10, { 1: short, 4: short }))), { params });
    return three.bars[9].suspect === true && two.bars[9].suspect === false;
  },
  xBoundary: async M => {
    const at = d => L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1, { x: 10 }), L.n('D5', 1, { x: 60 }), L.n('E5', 1, { x: 110 }), L.n('F5', 1, { x: 160 })],
      lh: [L.n('C3', 1, { x: 10 + d }), L.n('G3', 1, { x: 60 }), L.n('C3', 1, { x: 110 }), L.n('G3', 1, { x: 160 })] } })));
    return M.analyze(await at(20), { params: L.only('x-misaligned') }).suspect.join() === '2' && M.analyze(await at(19), { params: L.only('x-misaligned') }).suspect.length === 0;
  },
  sparseWindow: async M => {
    const heads = k => (k === 12 ? { rh: new Array(8).fill(0).map((_, i) => L.n(['C5', 'D5', 'E5', 'F5'][i % 4], 0.5)), lh: [L.n('C3', 1), L.n('G3', 1), L.n('C3', 1), L.n('G3', 1)] }
      : k === 4 ? { rh: [L.n('C5', 2), L.n('E5', 2)], lh: [L.n('C3', 2), L.n('G3', 2)] } : { rh: [L.n('C5', 4)], lh: [L.n('C3', 4)] });
    const g = await L.graphOf(L.doc([4, 2, 12, 4, 4, 4, 12, 2, 4].map(heads)));
    return M.analyze(g, { params: L.only('sparse', 'weak') }).bars[4].weak.includes('sparse');
  },
  ledgerBoundary: async M => M.ledgers(39, 30) === 0 && M.ledgers(40, 30) === 1 && M.ledgers(42, 30) === 2 && M.ledgers(29, 30) === 0 && M.ledgers(28, 30) === 1 && M.ledgers(27, 30) === 1 && M.ledgers(26, 30) === 2,
  chordLeap: async M => {
    const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1), L.n(['C3', 'E3'], 1)] } })));
    return M.extract(g).bars[1].leap < M.PARAMS.thr.leap;
  },
  graceIgnored: async M => {
    const g = JSON.parse(JSON.stringify(await L.graphOf(L.doc(bars(3)))));
    const staff = g.parts[0].staves[0].id, m = g.timeline.measures[1].id;
    const third = g.parts[0].events.filter(e => e.m === m && e.staff === staff)[2];
    g.parts[0].events.push({ id: 'eg1', kind: 'note', m: m, at: third.at, dur: '0', voice: third.voice, staff: staff, grace: { order: 1 }, display: { type: 'eighth' }, heads: [{ id: 'hg1', pitch: { step: 'D', oct: 6 } }] });
    const f = M.extract(g).bars[1];
    return f.overlap === 0 && f.hole === 0 && f.short === 0 && f.notes === 8 && f.heads === 8;
  },
  /* the report merge */
  mergeCap: async M => {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
    const res = M.analyze(await L.graphOf(L.doc(bars(8))), {});
    const out = M.mergeIntoReport({ confidence: 0.8875, level: 'good', suspectMeasures: [3], issues: [], summary: 'Recognition looks clean: 8 measures, 31 notes.', advice: null }, res, { numbers, notes: 31 });
    const clean = M.mergeIntoReport({ confidence: 1, level: 'good', suspectMeasures: [], issues: [], summary: 'clean', advice: null }, res, { numbers, notes: 32 });
    return out.confidence < M.GOOD && out.level !== 'good' && out.suspectMeasures.join() === '3' && /need checking/.test(out.summary) && clean.confidence === 1 && clean.summary === 'clean';
  },
  mergeFlags: async M => {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
    const res = M.analyze(await L.graphOf(L.doc(bars(8, { 5: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } }))), {});
    const both = M.mergeIntoReport({ confidence: 0.95, level: 'good', suspectMeasures: [2], issues: [], summary: 's', advice: null }, res, { numbers, notes: 30 });
    return both.suspectMeasures.join() === '2,5' && JSON.stringify(both.flagCodes) === '{"5":["fill-short"]}' && both.issues.some(i => i.measure === 5 && i.kind === 'flag') && both.confidence < M.GOOD && both.flagsVersion === M.VERSION;
  },
  mergePartial: async M => {
    const res = M.analyze(await L.graphOf(L.doc(bars(4))), {});
    const part = M.mergeIntoReport({ confidence: 1, level: 'good', suspectMeasures: [], issues: [] }, res, { numbers: [1, 2, 3, 4], notes: 16, partial: 'no-notation-checker' });
    return part.flagsPartial === 'no-notation-checker' && part.issues.some(i => i.kind === 'flags-partial' && i.measure === null);
  }
};

/* the mutations. `cases`: a code of the case table (a case of that signal must fail), or `checks`: names of CHECKS (one must fail) */
const sigLine = code => {
  const line = source.split('\n').find(l => l.startsWith("    '" + code + "': { test:"));
  assert.ok(line, 'the signal line of ' + code);
  return line;
};
const MUTATIONS = [
  /* extraction */
  { id: 'MUT-SHORT-BLIND', why: 'a voice that ends early is not seen', edits: [['if (!closes && cur < len - EPS) b.short = Math.max(b.short, len - cur);', '']], cases: ['fill-short'] },
  { id: 'MUT-HOLE-BLIND', why: 'a hole inside a voice is not seen', edits: [['if (at > cur + EPS) hole += at - cur;', 'if (false) hole += at - cur;']], cases: ['fill-short'] },
  { id: 'MUT-OVERLAP-BLIND', why: 'two notes overlapping in a voice are not seen', edits: [['else if (at < cur - EPS) overlap += cur - at;', '']], cases: ['fill-overlap'] },
  { id: 'MUT-OVER-BLIND', why: 'a voice that runs past its bar is not seen', edits: [['if (cur > len + EPS) b.over = Math.max(b.over, cur - len);', '']], cases: ['fill-over'] },
  { id: 'MUT-LENDIFF-BLIND', why: 'a bar longer than its metre is not seen', edits: [['bars[i].lenDiff = Math.round((R.barQ[i] - lenOf(i)) * 1e4) / 1e4;', '']], cases: ['fill-over'] },
  { id: 'MUT-NO-PICKUP-LENGTH', why: 'a pickup is held to the metre', edits: [['const lenOf = i => (i === 0 && pickup ? R.barQ[0] : R.nomQ[i]);', 'const lenOf = i => R.nomQ[i];']], clean: true },
  { id: 'MUT-NO-PICKUP-CLOSE', why: 'the last bar of a piece that began on a pickup is held to the whole metre', edits: [['const closes = i === n - 1 && pickupGap > EPS && near(cur, pickupGap);', 'const closes = false;']], clean: true },
  { id: 'MUT-NO-PICKUP-NC5', why: 'the checker\'s class 5 on that last bar is believed', edits: [['bars.forEach(b => { if (b.closes) b.nc5 = 0; });', '']], clean: true },
  { id: 'MUT-MEASURE-REST', why: 'a whole-bar rest is held to its own length', edits: [['if (e.display && e.display.measureRest) { cur = Math.max(cur, len); continue; }', '']], clean: true },
  { id: 'MUT-EMPTY-STAFF', why: 'a staff with nothing in a bar is not counted', edits: [['if (!staffHas.has(k)) b.emptyStaff++;', '']], cases: ['empty-staff'] },
  { id: 'MUT-VOICES', why: 'the voices of a staff are not counted', edits: [['perStaff.forEach(c => { b.voices = Math.max(b.voices, c); });', '']], cases: ['many-voices'] },
  { id: 'MUT-VB', why: 'the voices that have notes are not counted', edits: [["if (evs.some(e => e.kind === 'note')) b.vb++;", '']], cases: ['voice-loss'] },
  { id: 'MUT-CROSS', why: 'a hand below the other is not seen', edits: [['if (b.lo1 !== null && b.hi2 !== null && b.lo1 < b.hi2) b.cross = 1;', '']], cases: ['hands-cross'] },
  { id: 'MUT-LEAP', why: 'a leap is not measured', edits: [['if (prev !== undefined && e.heads.length === 1) b.leap = Math.max(b.leap, Math.abs(midis[0] - prev));', '']], cases: ['big-leap'] },
  { id: 'MUT-LEAP-CARRY', why: 'the last note of a bar is forgotten at the bar line', edits: [['vlast.forEach((v, k) => lastTop.set(k, v));', '']], cases: ['big-leap'] },
  { id: 'MUT-DUP', why: 'a doubled pitch is not counted', edits: [['if (seen.has(pk)) b.dup++; else seen.add(pk);', 'seen.add(pk);']], cases: ['dup-pitch'] },
  { id: 'MUT-LEDGER', why: 'ledger lines are not counted', edits: [['b.ledger = Math.max(b.ledger, ledgers(dposOf(h.pitch), bottom));', '']], cases: ['ledger'] },
  { id: 'MUT-LEDGER-CLEF', why: 'every staff is read in the treble clef', edits: [['const bottom = clefBottom(clefAt(e.staff, i));', 'const bottom = 30;']], clean: true },
  { id: 'MUT-OFFKEY', why: 'off-key notes are not counted', edits: [['if (!scale.has(((midis[hn] % 12) + 12) % 12)) b.offKey++;', '']], cases: ['off-key'] },
  { id: 'MUT-KEY-IGNORED', why: 'the key signature is not read', edits: [['MAJOR.forEach(s => scale.add((((s + 7 * R.fifths[i]) % 12) + 12) % 12));', 'MAJOR.forEach(s => scale.add(s));']], clean: true },
  { id: 'MUT-KEY-NOT-CARRIED', why: 'a key signature holds for its bar only', edits: [['if (Number.isInteger(keys[ki].fifths)) key = keys[ki].fifths; ki++;', 'ki++;']], clean: true },
  { id: 'MUT-X', why: 'notes that start together but are far apart on the page are not seen', edits: [['at.forEach(list => { if (list.length > 1) b.xMis = Math.max(b.xMis, Math.max.apply(null, list) - Math.min.apply(null, list)); });', '']], cases: ['x-misaligned'] },
  { id: 'MUT-NEW-SYSTEM', why: 'the engine\'s system breaks are not read', edits: [['if (i === 0 || lay.newSystem || lay.newPage) { sys++; pos = 0; }', 'if (i === 0) { sys++; pos = 0; }']], cases: ['page-bars'] },
  { id: 'MUT-NC5', why: 'class 5 of the notation checker is dropped', edits: [['[5, 6, 7, 8].forEach(c =>', '[6, 7, 8].forEach(c =>']], cases: ['sum-mismatch'] },
  { id: 'MUT-NC6', why: 'class 6 is dropped', edits: [['[5, 6, 7, 8].forEach(c =>', '[5, 7, 8].forEach(c =>']], cases: ['value'] },
  { id: 'MUT-NC7', why: 'class 7 is dropped', edits: [['[5, 6, 7, 8].forEach(c =>', '[5, 6, 8].forEach(c =>']], cases: ['tuplet'] },
  { id: 'MUT-NC8', why: 'class 8 is dropped', edits: [['[5, 6, 7, 8].forEach(c =>', '[5, 6, 7].forEach(c =>']], cases: ['same-note'] },
  { id: 'MUT-NOMINAL', why: 'the metre\'s length is read without its quarter', edits: [['meter.beats.reduce((s, x) => s + x, 0) * 4 / meter.beatType', 'meter.beats.reduce((s, x) => s + x, 0) / meter.beatType']], checks: ['threeFour'], cases: ['fill-short'] },
  { id: 'MUT-NEIGHBOUR-SCALE', why: 'a bar is not compared with its neighbours', edits: [['b.hLocal = nb.length >= 2 && b.heads > 0 ? b.heads / median(nb) : 1;', 'b.hLocal = 1;']], cases: ['sparse', 'dense'] },
  { id: 'MUT-VOICE-SCALE', why: 'a bar is not compared with the piece\'s voices', edits: [['b.vbDoc = feat.doc.medVb && b.notes > 0 ? b.vb / feat.doc.medVb : 1;', 'b.vbDoc = 1;']], cases: ['voice-loss'] },
  /* the signals, one by one (each test replaced by nothing) */
  ...['fill-short', 'fill-over', 'fill-overlap', 'empty-staff', 'many-voices', 'tuplet', 'value', 'sum-mismatch', 'same-note', 'x-misaligned', 'hands-cross', 'big-leap', 'sparse', 'dense',
    'voice-loss', 'dup-pitch', 'off-key', 'ledger', 'rebuilt', 'switched', 'repaired', 'unreadable-lengths', 'dropped', 'fragmented', 'joined', 'page-bars'].map(code => ({
    id: 'MUT-SIGNAL-' + code, why: 'the signal ' + code + ' never fires', edits: [[sigLine(code), "    '" + code + "': { test: () => null },"]], cases: [code] })),
  { id: 'MUT-REBUILT-PAIR', why: 'a merged pair is not "rebuilt"', edits: [["c.n.indexOf('pair-merged') >= 0 || c.n.indexOf('folded') >= 0", "c.n.indexOf('folded') >= 0"]], cases: ['rebuilt'] },
  { id: 'MUT-REBUILT-FOLDED', why: 'a folded system is not "rebuilt"', edits: [["c.n.indexOf('pair-merged') >= 0 || c.n.indexOf('folded') >= 0", "c.n.indexOf('pair-merged') >= 0"]], cases: ['rebuilt'] },
  { id: 'MUT-REPAIRED-DIV', why: 'repaired divisions are not "repaired"', edits: [["c.n.indexOf('divisions-repaired') >= 0 || c.n.indexOf('duration-repaired') >= 0", "c.n.indexOf('duration-repaired') >= 0"]], cases: ['repaired'] },
  { id: 'MUT-REPAIRED-DUR', why: 'a repaired length is not "repaired"', edits: [["c.n.indexOf('divisions-repaired') >= 0 || c.n.indexOf('duration-repaired') >= 0", "c.n.indexOf('divisions-repaired') >= 0"]], cases: ['repaired'] },
  { id: 'MUT-UNREADABLE-DIV', why: 'unknown divisions are not "unreadable"', edits: [["c.n.indexOf('divisions-unknown') >= 0 || c.n.indexOf('duration-zero') >= 0", "c.n.indexOf('duration-zero') >= 0"]], cases: ['unreadable-lengths'] },
  { id: 'MUT-UNREADABLE-ZERO', why: 'a zero length is not "unreadable"', edits: [["c.n.indexOf('divisions-unknown') >= 0 || c.n.indexOf('duration-zero') >= 0", "c.n.indexOf('divisions-unknown') >= 0"]], cases: ['unreadable-lengths'] },
  { id: 'MUT-PAGE-BARS-PAGE', why: 'a page-level mismatch loses its flag', edits: [['c.shown.page ? { shown: c.shown.shown, read: c.shown.read, page: true } :', 'false ? null :']], cases: ['page-bars'] },
  /* the rule */
  { id: 'MUT-RULE-NO-STRONG', why: 'a strong signal alone does not flag', edits: [['suspect: strong.length > 0 || weak.length >= P.weakNeeded', 'suspect: weak.length >= P.weakNeeded']], checks: ['strongAlone'] },
  { id: 'MUT-RULE-NO-WEAK', why: 'weak signals never add up', edits: [['suspect: strong.length > 0 || weak.length >= P.weakNeeded', 'suspect: strong.length > 0']], checks: ['twoWeakAreEnough'] },
  { id: 'MUT-RULE-ONE-WEAK', why: 'one weak signal flags', edits: [['weak.length >= P.weakNeeded', 'weak.length >= 1']], checks: ['oneWeakIsNotEnough', 'twoWeakAreEnough'] },
  { id: 'MUT-RULE-FIXED-COUNT', why: 'weakNeeded is not read', edits: [['weak.length >= P.weakNeeded', 'weak.length >= 2']], checks: ['twoWeakAreEnough'] },
  { id: 'MUT-NO-BAD-PAGE', why: 'a page is never bad', edits: [['const badPage = share >= thr.badPage ? share : 0;', 'const badPage = 0;']], checks: ['badPage'] },
  { id: 'MUT-BAD-PAGE-ALWAYS', why: 'every page is bad', edits: [['const badPage = share >= thr.badPage ? share : 0;', 'const badPage = 1;']], checks: ['badPageShare', 'badPage'] },
  { id: 'MUT-SHARE-OF-ONE', why: 'the share is a count, not a fraction', edits: [[', 0) / n : 0;', ', 0) / 1 : 0;']], checks: ['badPageShare'] },
  { id: 'MUT-NEXT-LEFT', why: 'the bar before a bad one is not "next to" it', edits: [['(i > 0 && isStrong(i - 1)) || (i + 1 < n && isStrong(i + 1))', '(i + 1 < n && isStrong(i + 1))']], checks: ['nextToBad'] },
  { id: 'MUT-NEXT-RIGHT', why: 'the bar after a bad one is not "next to" it', edits: [['(i > 0 && isStrong(i - 1)) || (i + 1 < n && isStrong(i + 1))', '(i > 0 && isStrong(i - 1))']], checks: ['nextToBad'] },
  { id: 'MUT-EXTERNAL-ALWAYS-WEAK', why: 'an outside flag is never strong', edits: [["strength: o.strength === 'strong' ? 'strong' : 'weak', text:", "strength: 'weak', text:"]], checks: ['external'] },
  { id: 'MUT-EXTERNAL-SHARE', why: 'an outside strong flag does not count towards the page', edits: [["(external[i + 1] || []).some(x => x && typeof x === 'object' && x.strength === 'strong')", 'false']], checks: ['external'] },
  { id: 'MUT-EXTERNAL-IGNORED', why: 'outside flags are not read', edits: [['(external[i + 1] || []).forEach(x => {', '([]).forEach(x => {']], checks: ['external'] },
  { id: 'MUT-PAGEBARS-EQUAL', why: 'a system with the right number of bars is flagged', edits: [['if (list.length !== shown[s]) list.forEach', 'if (list.length === shown[s]) list.forEach']], cases: ['page-bars'] },
  { id: 'MUT-PAGEBARS-TOTAL', why: 'a page whose lines differ in number is never flagged', edits: [['if (total !== idx.length) idx.forEach', 'if (false) idx.forEach']], cases: ['page-bars'] },
  { id: 'MUT-PAGEBARS-SYSPOS', why: 'a page\'s systems are not told apart', edits: [['if (k === 0 || bars[i].sysPos === 0) read.push([]);', 'if (k === 0) read.push([]);']], cases: ['page-bars'] },
  /* the confidence, the answer, the sentence */
  { id: 'MUT-CONF-NO-CAP', why: 'the confidence is not capped below good', edits: [['return Math.max(0.05, Math.min(b, GOOD - 0.01 - 0.6 * share));', 'return Math.max(0.05, b);']], checks: ['confidence'] },
  { id: 'MUT-CONF-AT-GOOD', why: 'the cap is good itself', edits: [['GOOD - 0.01 - 0.6 * share', 'GOOD - 0.6 * share']], checks: ['confidence'] },
  { id: 'MUT-CONF-NO-SHARE', why: 'more suspect bars do not lower it', edits: [['GOOD - 0.01 - 0.6 * share', 'GOOD - 0.01']], checks: ['confidence'] },
  { id: 'MUT-CONF-QUIET-CAP', why: 'a score with nothing suspect is capped too', edits: [['if (!suspectCount) return b;', '']], checks: ['confidence'] },
  { id: 'MUT-BAR-NUMBER', why: 'bars are numbered from 0', edits: [['return { n: i + 1, suspect:', 'return { n: i, suspect:']], checks: ['numbers'] },
  { id: 'MUT-SUSPECT-LIST', why: 'the suspect list is empty', edits: [['const suspect = bars.filter(b => b.suspect).map(b => b.n);', 'const suspect = [];']], checks: ['numbers'] },
  { id: 'MUT-COUNTS', why: 'the reasons are not counted', edits: [['bars.forEach(b => b.reasons.forEach(r => { counts[r.code] = (counts[r.code] || 0) + 1; }));', '']], checks: ['numbers'] },
  { id: 'MUT-TX-ONE-NUMBER', why: 'only the first number of a sentence is filled in', edits: [['/\\{\\{(\\w+)\\}\\}/g', '/\\{\\{(\\w+)\\}\\}/']], checks: ['sentences'] },
  { id: 'MUT-PAGE-SENTENCE', why: 'a page-level mismatch is worded as a line', edits: [["return r.page\n          ? tx('The page shows {{shown}} measures in all, PPP read {{read}}.', { shown: r.shown, read: r.read })\n          :", 'return false ? null :']], checks: ['sentences'] },
  /* what the independent review's mutants found unpinned, and the report merge */
  { id: 'MUT-REASON-ORDER', why: 'reasons are not said strong first', edits: [["list.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'strong' ? -1 : 1));", '']], checks: ['reasonOrder'] },
  { id: 'MUT-BADPAGE-STRICT', why: 'a score is bad only above the threshold, not at it', edits: [['const badPage = share >= thr.badPage ? share : 0;', 'const badPage = share > thr.badPage ? share : 0;']], checks: ['badPageBoundary'] },
  { id: 'MUT-X-STRICT', why: 'x-misaligned fires only above 20 tenths', edits: [['b.xMis >= c.thr.xMis', 'b.xMis > c.thr.xMis']], checks: ['xBoundary'] },
  { id: 'MUT-X-LOOSE', why: 'x-misaligned fires from 19 tenths', edits: [['b.xMis >= c.thr.xMis', 'b.xMis >= c.thr.xMis - 1']], checks: ['xBoundary'] },
  { id: 'MUT-SPARSE-WINDOW-ONE', why: 'a bar is compared with one bar on each side', edits: [['for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++)', 'for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++)']], checks: ['sparseWindow'] },
  { id: 'MUT-SPARSE-WINDOW-THREE', why: 'a bar is compared with three bars on each side', edits: [['for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++)', 'for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++)']], checks: ['sparseWindow'] },
  { id: 'MUT-LEDGER-ABOVE', why: 'the first ledger line above the staff is one step too high', edits: [['return Math.floor((dpos - (bottom + 8)) / 2);', 'return Math.floor((dpos - (bottom + 9)) / 2);']], checks: ['ledgerBoundary'] },
  { id: 'MUT-LEDGER-BELOW', why: 'the ledger lines below the staff are counted from the wrong step', edits: [['return Math.floor((bottom - dpos) / 2);', 'return Math.floor((bottom - dpos + 1) / 2);']], checks: ['ledgerBoundary'] },
  { id: 'MUT-LEDGER-COUNT', why: 'one ledger line more is counted', edits: [['return Math.floor((dpos - (bottom + 8)) / 2);', 'return Math.floor((dpos - (bottom + 8)) / 2) + 1;']], checks: ['ledgerBoundary'] },
  { id: 'MUT-CHORD-LEAP', why: 'a chord is measured as a leap from its first head', edits: [['if (prev !== undefined && e.heads.length === 1) b.leap', 'if (prev !== undefined) b.leap']], checks: ['chordLeap'] },
  { id: 'MUT-GRACE-FILL', why: 'a grace note counts in the fill of its voice', edits: [['const evs = vb.evs.filter(e => !e.grace).sort(', 'const evs = vb.evs.slice().sort(']], checks: ['graceIgnored'] },
  { id: 'MUT-GRACE-NOTES', why: 'a grace note is a note of the bar', edits: [["e.kind === 'note' && !e.grace && e.heads && e.heads.length", "e.kind === 'note' && e.heads && e.heads.length"]], checks: ['graceIgnored'] },
  { id: 'MUT-MERGE-VALIDATOR-UNCAPPED', why: 'the confidence is capped only when the flags marked a bar (the review\'s major finding)', edits: [['if (!suspect.length) return report;', 'if (!Object.keys(codes).length) return report;']], checks: ['mergeCap'] },
  { id: 'MUT-MERGE-NO-CAP', why: 'the confidence is not capped', edits: [['report.confidence = confidenceOf(suspect.length, numbers.length, report.confidence);', '']], checks: ['mergeCap', 'mergeFlags'] },
  { id: 'MUT-MERGE-LEVEL', why: 'the level is not recomputed', edits: [["report.level = report.confidence >= GOOD ? 'good' : report.confidence >= 0.55 ? 'fair' : 'poor';", '']], checks: ['mergeCap'] },
  { id: 'MUT-MERGE-SUMMARY', why: 'the summary still says clean', edits: [['report.summary = tx(suspect.length === 1', 'void tx(suspect.length === 1']], checks: ['mergeCap'] },
  { id: 'MUT-MERGE-DROPS-VALIDATOR', why: 'the validator\'s suspect bars are replaced by the flags\'', edits: [['const had = new Set(report.suspectMeasures || []);', 'const had = new Set();']], checks: ['mergeFlags'] },
  { id: 'MUT-MERGE-CODES', why: 'the codes are not kept', edits: [['if (Object.keys(codes).length) report.flagCodes = codes;', '']], checks: ['mergeFlags'] },
  { id: 'MUT-MERGE-ISSUE', why: 'a flagged bar has no issue line', edits: [["report.issues.push({ measure: m, kind: 'flag',", "void ({ measure: m, kind: 'flag',"]], checks: ['mergeFlags'] },
  { id: 'MUT-MERGE-PARTIAL', why: 'a partial run is said to be a whole one', edits: [["report.flagsPartial = String(info.partial);", '']], checks: ['mergePartial'] }
];

test('MUT-NOOP: a copy of the module with a comment changed is the module', async () => {
  const M = mutant([['(function (root, factory) {', '/* the control */\n(function (root, factory) {']]);
  for (const c of S.CASES) assert.ok((await S.runCase(M, c)).ok, c.id);
  for (const c of S.CLEAN) assert.ok((await S.runClean(M, c)).ok, c.id);
  for (const name of Object.keys(CHECKS)) assert.ok(await CHECKS[name](M), name);
});

test('the real module passes every check', async () => {
  const M = require(SRC);
  for (const name of Object.keys(CHECKS)) assert.ok(await CHECKS[name](M), name);
});

for (const m of MUTATIONS) {
  test(m.id + ': ' + m.why, async () => {
    const M = mutant(m.edits);
    const caught = [];
    if (m.cases) for (const c of S.CASES.filter(x => m.cases.includes(x.code))) {
      let bad = false;
      try { bad = !(await S.runCase(M, c)).ok; } catch (e) { bad = true; }
      if (bad) caught.push(c.id);
    }
    if (m.clean) for (const c of S.CLEAN) {
      let bad = false;
      try { bad = !(await S.runClean(M, c)).ok; } catch (e) { bad = true; }
      if (bad) caught.push(c.id);
    }
    if (m.checks) for (const name of m.checks) {
      let bad = false;
      try { bad = !(await CHECKS[name](M)); } catch (e) { bad = true; }
      if (bad) caught.push(name);
    }
    assert.ok(caught.length > 0, m.id + ' went unnoticed: ' + m.why);
  });
}
