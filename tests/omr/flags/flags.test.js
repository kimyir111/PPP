'use strict';
/* omr/flags.js (docs/GOALS/G12_OMR.md section 8, gate A3): which bars of an OMR import are suspect, and why.

   Node only. Every signal has a case that fires it on one bar and on no other (scenarios.js), the rule (any strong, or two weak) is tested on its own, the
   report's confidence, the sentences of the reasons, the fitted parameters against the record of the fit, and music that is right (catalogue scores fed back as if
   recognised) must stay quiet. tests/omr/flags/mutation.test.js breaks the module one line at a time and checks that these cases notice. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');
const L = require('./lib.js');
const F = L.F;

const bars = (k, edits) => L.plainBars(k, edits);

test('every signal has a case that fires it on one bar and on no other', async () => {
  for (const c of S.CASES) {
    const r = await S.runCase(F, c);
    assert.ok(r.ok, c.id + ': ' + JSON.stringify(r));
  }
  const covered = new Set(S.CASES.map(c => c.code));
  F.CODES.filter(code => code !== 'bad-page' && code !== 'next-to-bad').forEach(code => assert.ok(covered.has(code), 'a case for ' + code));
});

test('music without a fault stays quiet, a pickup and the bar that completes it included', async () => {
  for (const c of S.CLEAN) {
    const r = await S.runClean(F, c);
    assert.ok(r.ok, c.id + ': ' + JSON.stringify(r));
  }
});

test('the rule: any strong signal flags a bar; one weak signal does not; two do', async () => {
  const g = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C4', 1), L.n('C6', 1), L.n('D6', 1), L.n('E6', 1)], lh: [L.n('C4', 1), L.n('G3', 1), L.n('C4', 1), L.n('G3', 1)] } })));
  const thr = Object.assign({}, F.PARAMS.thr);
  // bar 2 has a big leap (C4 to C6); the hands do not cross (the right hand's lowest note, C4, is not below the left hand's highest, C4)
  const leapOnly = F.analyze(g, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 2, thr } });
  assert.deepEqual(leapOnly.bars[1].weak, ['big-leap'], 'only the leap fires');
  assert.equal(leapOnly.bars[1].suspect, false, 'one weak signal is not enough');
  assert.deepEqual(leapOnly.suspect, []);
  const asStrong = F.analyze(g, { params: { strong: ['big-leap'], weak: [], weakNeeded: 2, thr } });
  assert.deepEqual(asStrong.suspect, [2], 'the same signal, strong, flags the bar');
  const g2 = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C3', 1), L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)], lh: [L.n('C4', 1), L.n('G3', 1), L.n('C4', 1), L.n('G3', 1)] } })));
  const two = F.analyze(g2, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 2, thr } });
  assert.deepEqual(two.bars[1].weak.sort(), ['big-leap', 'hands-cross'], 'both fire');
  assert.deepEqual(two.suspect, [2], 'two weak signals flag the bar');
  const needThree = F.analyze(g2, { params: { strong: [], weak: ['big-leap', 'hands-cross'], weakNeeded: 3, thr } });
  assert.deepEqual(needThree.suspect, [], 'weakNeeded is read');
  const oneEnough = F.analyze(g, { params: { strong: [], weak: ['big-leap'], weakNeeded: 1, thr } });
  assert.deepEqual(oneEnough.suspect, [2], 'weakNeeded 1');
});

test('a signal that is in neither list is not used', async () => {
  const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
  const res = F.analyze(g, { params: { strong: [], weak: [], weakNeeded: 1, thr: F.PARAMS.thr } });
  assert.deepEqual(res.suspect, []);
  assert.deepEqual(res.bars[1].reasons, []);
});

test('the page as a whole: bad-page is a weak signal that every bar of a badly read page carries', async () => {
  // four of five bars are short (strong): the share is 0.8, over the threshold; bar 3 is fine in itself and carries one weak signal (a leap)
  const edits = { 1: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] }, 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] }, 4: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] }, 5: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] },
    3: { rh: [L.n('C4', 1), L.n('C6', 1), L.n('D6', 1), L.n('E6', 1)] } };
  const g = await L.graphOf(L.doc(bars(5, edits)));
  const params = { strong: ['fill-short'], weak: ['big-leap', 'bad-page'], weakNeeded: 2, thr: Object.assign({}, F.PARAMS.thr, { badPage: 0.3 }) };
  const res = F.analyze(g, { params });
  assert.ok(res.bars[2].weak.includes('bad-page') && res.bars[2].weak.includes('big-leap'), 'the quiet bar of a bad page carries the page signal: ' + JSON.stringify(res.bars[2]));
  assert.equal(res.bars[2].suspect, true, 'and so one more doubt flags it');
  const quiet = F.analyze(g, { params: Object.assign({}, params, { thr: Object.assign({}, params.thr, { badPage: 0.9 }) }) });
  assert.equal(quiet.bars[2].suspect, false, 'a page that is not bad enough does not');
  assert.ok(!quiet.bars[2].weak.includes('bad-page'));
  // the same bar on a good page: one weak signal alone
  const good = await L.graphOf(L.doc(bars(5, { 3: edits[3] })));
  assert.equal(F.analyze(good, { params }).bars[2].suspect, false, 'a good page: one doubt is not enough');
});

test('next to a bar that does not add up', async () => {
  const g = await L.graphOf(L.doc(bars(5, { 3: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
  const res = F.analyze(g, { params: { strong: ['fill-short'], weak: ['next-to-bad'], weakNeeded: 1, thr: F.PARAMS.thr } });
  assert.deepEqual(res.suspect, [2, 3, 4], 'the short bar and its two neighbours');
  assert.deepEqual(res.bars[1].weak, ['next-to-bad']);
  assert.deepEqual(res.bars[0].weak, [], 'not the bar before that');
});

test('flags from outside: a string is a weak flag, an object may be strong, a bad entry is ignored', async () => {
  const g = await L.graphOf(L.doc(bars(4)));
  const base = { strong: [], weak: [], weakNeeded: 2, thr: F.PARAMS.thr };
  let res = F.analyze(g, { params: base, external: { 2: ['second-pass'] } });
  assert.deepEqual(res.suspect, [], 'one weak external flag alone');
  assert.deepEqual(res.bars[1].weak, ['second-pass']);
  res = F.analyze(g, { params: base, external: { 2: ['second-pass', 'missing-heads'] } });
  assert.deepEqual(res.suspect, [2], 'two weak external flags');
  res = F.analyze(g, { params: base, external: { 3: [{ code: 'missing-heads', strength: 'strong', text: 'The page shows 6 notes here, PPP read 5.' }] } });
  assert.deepEqual(res.suspect, [3], 'a strong external flag');
  assert.equal(F.reasonText(res.bars[2].reasons[0]), 'The page shows 6 notes here, PPP read 5.', 'it brings its own sentence');
  res = F.analyze(g, { params: base, external: { 2: [null, 7, {}, { strength: 'strong' }], 99: ['x'], zzz: ['y'] } });
  assert.deepEqual(res.suspect, [], 'entries that are not flags are ignored');
  const strongExt = F.analyze(g, { params: { strong: [], weak: ['bad-page'], weakNeeded: 2, thr: Object.assign({}, F.PARAMS.thr, { badPage: 0.2 }) }, external: { 1: [{ code: 'a', strength: 'strong' }], 2: [{ code: 'b', strength: 'strong' }] } });
  assert.deepEqual(strongExt.suspect, [1, 2], 'strong external flags count towards the share of the page, and a bar that has the page signal and nothing else is still not suspect');
});

test('the confidence is never "good" when any bar is suspect (gate A3), and falls with the share of bars', () => {
  assert.equal(F.confidenceOf(0, 40, 1), 1, 'nothing suspect: the base');
  assert.equal(F.confidenceOf(0, 40, 0.9), 0.9);
  for (const count of [1, 2, 5, 20, 40]) {
    for (const total of [count, count + 1, 40, 400, 4000]) {
      for (const base of [1, 0.99, 0.95, 0.85]) {
        const c = F.confidenceOf(count, total, base);
        assert.ok(c < F.GOOD, count + ' of ' + total + ' from ' + base + ' gives ' + c);
        assert.ok(c <= base && c >= 0.05);
      }
    }
  }
  assert.ok(F.confidenceOf(1, 40, 1) > F.confidenceOf(10, 40, 1) && F.confidenceOf(10, 40, 1) > F.confidenceOf(30, 40, 1), 'more suspect bars, less confidence');
  assert.ok(F.confidenceOf(1, 4000, 1) <= 0.84, 'one bar in four thousand still shows 84 % at most, never a round "good"');
  assert.equal(F.confidenceOf(3, 40, 0.3), 0.3, 'a base that is lower already stays');
  assert.equal(F.confidenceOf(3, 40, undefined), F.confidenceOf(3, 40, 1), 'no base: 1');
});

test('analyze puts the confidence on its result', async () => {
  const g = await L.graphOf(L.doc(bars(4, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
  const res = F.analyze(g, {});
  assert.deepEqual(res.suspect, [2]);
  assert.ok(res.confidence < F.GOOD);
  assert.equal(F.analyze(await L.graphOf(L.doc(bars(4))), {}).confidence, 1);
});

test('every reason has a sentence, in English by default and through the translator when there is one', () => {
  F.CODES.forEach(code => {
    const t = F.reasonText({ code }, null);
    assert.ok(typeof t === 'string' && t.length > 10 && !/\{\{/.test(t) || code === 'page-bars', code + ': ' + t);
  });
  assert.equal(F.reasonText({ code: 'page-bars', shown: 6, read: 5 }), 'The page shows 6 measures on this line, PPP read 5.');
  assert.equal(F.reasonText({ code: 'page-bars', shown: 24, read: 23, page: true }), 'The page shows 24 measures in all, PPP read 23.');
  assert.equal(F.reasonText({ code: 'rebuilt' }), 'This part was rebuilt from two staves.');
  assert.equal(F.reasonText({ code: 'fill-short' }), 'The notes do not fill this measure.');
  const seen = [];
  const tx = (src, vars) => { seen.push(src); return '<' + src.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k]) + '>'; };
  assert.equal(F.reasonText({ code: 'page-bars', shown: 3, read: 2 }, tx), '<The page shows 3 measures on this line, PPP read 2.>');
  assert.deepEqual(seen, ['The page shows {{shown}} measures on this line, PPP read {{read}}.'], 'the translator gets the English key and the numbers');
  assert.equal(F.reasonText({ code: 'something-new' }), 'Another check doubts this measure.');
  assert.equal(F.reasonText(null), 'Another check doubts this measure.');
});

test('never throws, never changes its input, is deterministic', async () => {
  for (const bad of [null, undefined, {}, [], 7, 'x', { timeline: {} }, { timeline: { measures: [] }, parts: [] }, { timeline: { measures: [{ id: 'm1', dur: 'x' }] }, parts: [{ events: [{ m: 'm1', kind: 'note' }] }] },
    { timeline: { measures: [{ id: 'm1', dur: '1' }] }, parts: [null] }]) {
    let res;
    assert.doesNotThrow(() => { res = F.analyze(bad, {}); }, JSON.stringify(bad));
    assert.ok(res && Array.isArray(res.suspect), 'an answer');
  }
  const g = await L.graphOf(L.doc(bars(4, { 3: { rh: [L.n('C5', 1), L.n('D5', 1)] } })));
  const before = JSON.stringify(g);
  const frozen = JSON.stringify(F.analyze(g, { normalize: { flags: { 2: ['pair-merged'] } }, external: { 1: ['x'] } }));
  assert.equal(JSON.stringify(g), before, 'the graph is not touched');
  assert.equal(JSON.stringify(F.analyze(g, { normalize: { flags: { 2: ['pair-merged'] } }, external: { 1: ['x'] } })), frozen, 'the same answer twice');
  assert.doesNotThrow(() => F.analyze(g, { normalize: 5, layout: 'x', external: 7, params: null }));
  assert.doesNotThrow(() => F.analyze(g, { normalize: { flags: { 2: 'pair-merged' }, structure: [null, { bars: 'x' }] }, layout: { pages: [null, 3, [1, 'a']] }, external: { 1: 'oops' } }));
});

test('the module is the same without the notation checker: sum-mismatch is the only signal that goes quiet', async () => {
  const src = fs.readFileSync(path.join(L.REPO, 'omr', 'flags.js'), 'utf8');
  const cut = src.replace("NC = require('../scoregraph/tools/notation-check.js');", () => 'NC = null;');
  assert.notEqual(cut, src);
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'omr-flags-nonc-'));
  try {
    fs.writeFileSync(path.join(dir, 'flags.js'), cut);
    const M = require(path.join(dir, 'flags.js'));
    const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } })));
    const res = M.analyze(g, { params: { strong: ['fill-short', 'sum-mismatch', 'tuplet', 'value', 'same-note'], weak: [], weakNeeded: 2, thr: M.PARAMS.thr } });
    assert.deepEqual(res.suspect, [2]);
    assert.deepEqual(res.bars[1].strong, ['fill-short'], 'the fill check does not need the checker');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a pickup is not a short bar, and the bar that completes it is not either; a real short bar after it is', async () => {
  const pick = { rh: [L.n('G4', 1)], lh: [L.r(1)] };
  const ok = await L.graphOf(L.doc([pick, L.plainBar(), L.plainBar(), { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)], lh: [L.n('C3', 2), L.n('G3', 1)] }], { pickup: true }));
  assert.deepEqual(F.analyze(ok, { params: L.only('fill-short') }).suspect, []);
  const bad = await L.graphOf(L.doc([pick, L.plainBar(), { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)], lh: [L.n('C3', 2), L.n('G3', 1)] }, L.plainBar()], { pickup: true }));
  assert.deepEqual(F.analyze(bad, { params: L.only('fill-short') }).suspect, [3], 'only a short bar in the middle');
  const pickupBad = await L.graphOf(L.doc([{ rh: [L.n('G4', 1)], lh: [L.r(1)] }, L.plainBar(), L.plainBar(), { rh: [L.n('C5', 1), L.n('D5', 1)], lh: [L.n('C3', 2)] }], { pickup: true }));
  assert.deepEqual(F.analyze(pickupBad, { params: L.only('fill-short') }).suspect, [4], 'a last bar that is shorter than the pickup lacks is short');
});

test('a measure rest fills its bar, whatever the bar', async () => {
  const g = await L.graphOf(L.doc(bars(3, { 2: { lh: [L.measureRest(4)] } }), {}));
  assert.deepEqual(F.analyze(g, { params: L.only('fill-short') }).suspect, []);
  const g34 = await L.graphOf(L.doc([{ rh: [L.n('C5', 2), L.n('D5', 1)], lh: [L.measureRest(3)] }, { rh: [L.n('C5', 3)], lh: [L.measureRest(3)] }], { time: [3, 4] }));
  assert.deepEqual(F.analyze(g34, { params: L.only('fill-short') }).suspect, [], 'in 3/4 too');
});

test('catalogue scores fed back as if they had been recognised: at most one flag in twenty bars (gate A3)', async () => {
  const files = ['catalog/hymns/all-creatures.musicxml', 'catalog/hymns/all-glory-laud.musicxml', 'catalog/hymns/all-hail-the-power.musicxml', 'catalog/hymns/blessed-assurance.musicxml', 'catalog/hymns/come-holy-spirit.musicxml',
    'catalog/gymnopedie-1.musicxml', 'catalog/happy-birthday.musicxml', 'catalog/fur-elise.musicxml'];
  let total = 0, flagged = 0;
  for (const f of files) {
    const got = await L.importer.importFile(fs.readFileSync(path.join(L.REPO, f)), { name: path.basename(f) });
    assert.ok(got.ok, f);
    const res = F.analyze(got.graph, {});
    total += res.bars.length;
    flagged += res.suspect.length;
  }
  assert.ok(total >= 100, 'enough bars: ' + total);
  assert.ok(flagged * 20 <= total, flagged + ' flags in ' + total + ' bars of correct music');
});

test('PARAMS is what the fit recorded, and uses only signals that exist', () => {
  const rec = JSON.parse(fs.readFileSync(path.join(L.REPO, 'tests', 'omr', 'baselines', 'flags-fit.json'), 'utf8'));
  assert.deepEqual(F.PARAMS, rec.params, 'omr/flags.js PARAMS and tests/omr/baselines/flags-fit.json params differ: refit (tests/omr/node/flags-fit.js fit --record) or restore');
  [].concat(F.PARAMS.strong, F.PARAMS.weak).forEach(code => assert.ok(F.CODES.includes(code), code));
  assert.equal(new Set([].concat(F.PARAMS.strong, F.PARAMS.weak)).size, F.PARAMS.strong.length + F.PARAMS.weak.length, 'a signal is strong or weak, not both');
  assert.ok(F.PARAMS.weakNeeded >= 2);
  assert.ok(rec.heldOut === undefined || typeof rec.heldOut === 'object');
});

test('pageBarsCheck: a page without a layout, or without a structure, says nothing', async () => {
  const g = await L.graphOf(L.doc(bars(4)));
  const feat = F.derive(F.extract(g));
  assert.deepEqual(F.pageBarsCheck(feat.bars, { structure: [{ page: 0, bars: 4 }] }, null), {});
  assert.deepEqual(F.pageBarsCheck(feat.bars, null, { pages: [[2, 2]] }), {});
  assert.deepEqual(F.pageBarsCheck(feat.bars, { structure: [{ page: 0, bars: 4 }] }, { pages: [null] }), {});
  assert.deepEqual(F.pageBarsCheck(feat.bars, { structure: [{ page: 0, bars: 4 }] }, { pages: [[4]] }), {}, 'equal: nothing');
});
