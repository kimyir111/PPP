/* The checks of practice/variant.js (G11c-0), on hand-written graphs (variant-fixtures.js). Each check takes the module (the real one, or a mutant of it:
   variant-mutation.test.js) and throws when the module does not do what section 8.2 of docs/GOALS/G11_ADAPTIVE_PRACTICE.md says. variant.test.js runs them one by one.
   Every accepted splice is also read by tests/practice-variant/variant-verify.js, which holds it to the same rules with code of its own. */
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const F = require('./variant-fixtures.js');
const VF = require('./variant-verify.js');
const { REPO, SG, mk, piece, bars } = F;
const { render } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const T = require(path.join(REPO, 'scoregraph', 'time.js'));

const HANGUL = /[가-힣]/;
const ok = (res, msg) => { assert.equal(res.ok, true, (msg || 'splice') + ': ' + (res.ok ? '' : res.reason + ' ' + res.detail)); return res; };
const refused = (res, reason, msg) => { assert.equal(res.ok, false, (msg || 'splice') + ' must be refused'); assert.equal(res.reason, reason, (msg || '') + ' ' + res.detail); return res; };
/* the independent verification of an accepted splice (the mutation test turns the engraver and the second splice off: it asks the same questions without them) */
let FAST = false;
const setFast = v => { FAST = !!v; };
function clean(base, variant, res, o, spliceOpts) {
  const fails = VF.verify(base, variant, res, Object.assign({ direction: 'easier', profile: 'large', engrave: !FAST, idempotent: !FAST, spliceOpts: spliceOpts }, o || {}));
  assert.deepEqual(fails, [], 'the verification found: ' + fails.slice(0, 3).join(' / '));
}
const staffBars = (g, i) => render(g)[i].split(' | ');
const ties = g => g.parts[0].spanners.filter(s => s.type === 'tie').length;
const spans = (g, type) => g.parts[0].spanners.filter(s => s.type === type);
const lineOf = (bar, list) => list[bar % list.length];

/* eight bars; rh/lh given per bar by fn(i) */
function custom(fnRh, fnLh, spec) {
  const rh = [], lh = [];
  for (let i = 0; i < 8; i++) { rh.push(fnRh(i)); lh.push(fnLh(i)); }
  return mk(Object.assign({ time: [4, 4], op: 'imported', id: 'x', rh: rh.join(' | '), lh: lh.join(' | ') }, spec || {}));
}
const BUSY = i => lineOf(i, F.BUSY_RH), BUSY_L = i => lineOf(i, F.BUSY_LH), PLAIN = i => lineOf(i, F.PLAIN_RH), PLAIN_L = i => lineOf(i, F.PLAIN_LH);

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name: name, fn: fn });

check('a passage is replaced by the variant\'s bars, everything else is byte for byte the base\'s', V => {
  const base = piece('busy'), variant = piece('plain');
  const o = { from: 2, to: 5, songId: 'song-1', level: 'beginner' };
  const res = ok(V.splice(base, variant, o));
  assert.deepEqual(res.range, { from: 2, to: 5 });
  assert.deepEqual(res.final, { from: 2, to: 5 });
  assert.deepEqual(res.widened, { left: 0, right: 0 });
  const rb = render(res.graph), rbase = render(base), rvar = render(variant);
  [0, 1].forEach(s => {
    const got = rb[s].split(' | '), a = rbase[s].split(' | '), b = rvar[s].split(' | ');
    for (let i = 0; i < 8; i++) assert.equal(got[i], i >= 2 && i <= 5 ? b[i] : a[i], 'staff ' + s + ' bar ' + (i + 1));
  });
  clean(base, variant, res, null, o);
  assert.equal(res.graph.rev, base.rev + 1);
  assert.ok(res.judge.delta >= V.JUDGE_MARGIN && res.judge.margin === V.JUDGE_MARGIN);
  assert.equal(res.stats.removedEvents, 64);
  assert.equal(res.stats.addedEvents, 12);
});

check('provenance: copied events carry the variant\'s source with op generated, and the copy records variantOf', V => {
  const base = piece('busy'), variant = piece('plain');
  const res = ok(V.splice(base, variant, { from: 2, to: 5, songId: 'song-1', level: 'beginner' }));
  const g = res.graph, p = g.parts[0], mids = new Set(g.timeline.measures.slice(2, 6).map(m => m.id));
  const added = p.events.filter(e => mids.has(e.m));
  assert.equal(added.length, 12);
  added.forEach(e => {
    assert.ok(g.provenance.sources.some(s => s.id === e.prov.src), 'event source exists');
    assert.equal(e.prov.op, 'generated');
    e.heads.forEach(h => { assert.ok(g.provenance.sources.some(s => s.id === h.prov.src)); assert.equal(h.prov.op, 'generated'); });
  });
  const src = g.provenance.sources.filter(s => s.tool === V.TOOL);
  assert.equal(src.length, 1);
  assert.equal(src[0].kind, 'generator');
  assert.deepEqual(src[0].params.variantOf, { from: 2, to: 5, direction: 'easier', songId: 'song-1', level: 'beginner' });
  assert.deepEqual(res.variantOf, { from: 2, to: 5, direction: 'easier', songId: 'song-1', level: 'beginner' });
  /* the events outside keep the base's provenance, and the base's sources are all still there */
  base.provenance.sources.forEach(s => assert.ok(g.provenance.sources.some(x => JSON.stringify(x) === JSON.stringify(s))));
});

check('bars that sound the same in both are refused, and the identical ends of a range are left alone', V => {
  const base = piece('busy');
  const same = V.splice(base, base, { from: 2, to: 5 });
  refused(same, 'VARIANT_IDENTICAL');
  assert.ok(HANGUL.test(same.message) && same.alternative.tempoPercent === 70, 'a Korean sentence and an alternative');
  /* the variant differs in bars 3 and 4 only (0-based) */
  const variant = custom(i => (i === 3 || i === 4 ? PLAIN(i) : BUSY(i)), i => (i === 3 || i === 4 ? PLAIN_L(i) : BUSY_L(i)));
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  assert.deepEqual(res.applied, { from: 3, to: 4 });
  assert.deepEqual(res.range, { from: 2, to: 5 });
  assert.equal(res.stats.removedEvents, 32);
  const gp = res.graph.parts[0], bp = base.parts[0];
  [2, 5].forEach(i => {
    const mid = base.timeline.measures[i].id;
    assert.deepEqual(gp.events.filter(e => e.m === mid), bp.events.filter(e => e.m === mid), 'bar ' + (i + 1) + ' untouched, ids and all');
  });
  clean(base, variant, res, null, o);
});

check('a tie across a seam is cut, the note keeps its value inside the range; the variant\'s ties across a seam are cut too', V => {
  const base = custom(i => (i === 1 ? 'C5:q D5:q E5:q C5:q~' : i === 2 ? 'C5:q D5:q E5:q F5:q' : i === 5 ? 'C5:q D5:q E5:q G5:q~' : i === 6 ? 'G5:q A5:q B5:q C6:q' : BUSY(i)), BUSY_L);
  const variant = custom(i => (i === 3 ? 'D5:h F5:h~' : i === 4 ? 'F5:h A5:h' : i === 5 ? 'C5:h G5:h~' : i === 6 ? 'G5:h C6:h' : PLAIN(i)), PLAIN_L);
  assert.equal(ties(base), 2);
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  assert.equal(res.seams.tiesCut, 2, 'both of the base\'s ties across the seams');
  assert.equal(res.seams.variantTiesCut, 1, 'the variant\'s tie out of the last bar');
  assert.equal(ties(res.graph), 1, 'the variant\'s tie inside the range came in');
  clean(base, variant, res, null, o);
});

check('a slur across a seam is cut; slurs of the range go with the notes, the variant\'s come in', V => {
  let base = F.addSlur(piece('busy'), 1, '0', 3, '0');          /* from before the range into it */
  base = F.addSlur(base, 3, '1/8', 4, '1/8');                     /* inside the range */
  base = F.addSlur(base, 6, '0', 7, '0');                         /* after it */
  let variant = F.addSlur(piece('plain'), 2, '0', 3, '0');        /* inside */
  variant = F.addSlur(variant, 5, '1/2', 6, '0');                 /* out of the last bar */
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  assert.equal(res.seams.slursCut, 1);
  assert.equal(res.seams.variantSlursCut, 1);
  assert.equal(spans(res.graph, 'slur').length, 2, 'the slur after the range and the variant\'s inside one');
  clean(base, variant, res, null, o);
});

check('pedal, 8va and wedge lines are clipped at the seams (one over the whole range becomes two); the variant\'s are clipped to the range', V => {
  let base = F.addPedal(piece('busy'), [0, '0'], [7, '3/4'], [[3, '0'], [6, '1/2']]);       /* over the whole range */
  base = F.addOttava(base, [1, '0'], [3, '0']);                                            /* into the range from the left */
  base = F.addOttava(base, [4, '0'], [6, '1/2']);                                          /* out of it to the right */
  base = F.addPedal(base, [3, '0'], [4, '0']);                                             /* inside: gone */
  let variant = F.addPedal(piece('plain'), [1, '0'], [4, '1/2']);
  variant = F.addOttava(variant, [4, '0'], [7, '0']);
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  assert.equal(res.seams.pedalClipped, 2, 'the long pedal and the inside one');
  assert.equal(res.seams.ottavaClipped, 2);
  const g = res.graph, ped = spans(g, 'pedal'), ott = spans(g, 'ottava');
  assert.equal(ped.length, 3, 'left part, right part, the variant\'s clipped one');
  assert.equal(ott.length, 3, 'the base\'s two clipped lines and the variant\'s');
  const at = (s, k) => g.timeline.measures.findIndex(m => m.id === s[k].m);
  const leftPedal = ped.find(s => at(s, 'to') <= 1), rightPedal = ped.find(s => at(s, 'from') === 6);
  assert.ok(leftPedal && rightPedal, 'the pedal lasts on both sides');
  assert.deepEqual(rightPedal.changes, [{ m: base.timeline.measures[6].id, at: '1/2' }], 'a change inside the range is dropped, one after it kept');
  const inner = ped.find(s => at(s, 'from') === 2);
  assert.ok(inner && at(inner, 'to') === 4, 'the variant\'s pedal from the start of the range to its own end');
  clean(base, variant, res, null, o);
});

check('the clef of a staff is carried into the range at the left seam and put back at the right one', V => {
  /* the base is in the treble clef on its lower staff from bar 2 on; the variant stays in the bass clef */
  const base = F.addClef(piece('busy'), 1, 1, 'G'), variant = piece('plain');
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  const state = i => { const c = res.graph.parts[0].clefs.filter(x => x.staff === res.graph.parts[0].staves[1].id && T.scorePos(res.graph, x).n <= T.measureStart(res.graph, res.graph.timeline.measures[i].id).n * 1).map(x => x.sign); return c; };
  void state;
  const lower = res.graph.parts[0].clefs.filter(c => c.staff === res.graph.parts[0].staves[1].id).map(c => c.sign + '@' + res.graph.timeline.measures.findIndex(m => m.id === c.m)).sort();
  assert.deepEqual(lower, ['F@0', 'F@2', 'G@1', 'G@6'], 'bass, treble from 2, bass for the range, treble again after it');
  assert.equal(res.seams.clefsAdded, 2);
  clean(base, variant, res, null, o);
  /* the variant goes into the treble clef inside the range; the base is in the bass clef: its clef change comes in and the bass is put back after the range */
  const variant2 = F.addClef(piece('plain'), 1, 3, 'G'), base2 = piece('busy');
  const res2 = ok(V.splice(base2, variant2, o));
  const lower2 = res2.graph.parts[0].clefs.filter(c => c.staff === res2.graph.parts[0].staves[1].id).map(c => c.sign + '@' + res2.graph.timeline.measures.findIndex(m => m.id === c.m)).sort();
  assert.deepEqual(lower2, ['F@0', 'F@6', 'G@3']);
  clean(base2, variant2, res2, null, o);
  /* a clef change inside the range that the variant does not have goes */
  const base3 = F.addClef(piece('busy'), 1, 4, 'G');
  const res3 = ok(V.splice(base3, piece('plain'), o));
  const lower3 = res3.graph.parts[0].clefs.filter(c => c.staff === res3.graph.parts[0].staves[1].id).map(c => c.sign + '@' + res3.graph.timeline.measures.findIndex(m => m.id === c.m)).sort();
  assert.deepEqual(lower3, ['F@0', 'G@6'], 'the base was in the treble clef at the end of the range, so it is put back');
  clean(base3, piece('plain'), res3, null, o);
});

check('the bars must be the same bars: count, duration, meter and key (VARIANT_TIMELINE)', V => {
  const base = piece('busy');
  refused(V.splice(base, piece('plain', { bars: 7 }), { from: 2, to: 5 }), 'VARIANT_TIMELINE', 'bar count');
  const short = custom(i => (i === 3 ? 'C5:h E5:q' : PLAIN(i)), i => (i === 3 ? 'C3:h.' : PLAIN_L(i)), { durs: ['1', '1', '1', '3/4', '1', '1', '1', '1'] });
  refused(V.splice(base, short, { from: 2, to: 5 }), 'VARIANT_TIMELINE', 'a bar of another length');
  /* a bar of another length FAR from the passage is outside the checked window (passage +- 2 bars) */
  const far = custom(i => (i === 7 ? 'C5:h E5:q' : PLAIN(i)), i => (i === 7 ? 'C3:h.' : PLAIN_L(i)), { durs: ['1', '1', '1', '1', '1', '1', '1', '3/4'] });
  ok(V.splice(base, far, { from: 0, to: 3 }), 'a short last bar far away');
  refused(V.splice(base, far, { from: 4, to: 6 }), 'VARIANT_TIMELINE', 'a short last bar one bar away');
  refused(V.splice(base, piece('plain', { spec: { key: { fifths: 2, mode: 'major' } } }), { from: 2, to: 5 }), 'VARIANT_TIMELINE', 'key');
  /* a key change near the passage that only the base has (the key in force at the start of the window is the same), and a key the two have from bar 1 on that differs
     while no key event lies in the window */
  refused(V.splice(piece('busy', { spec: { keys: [{ bar: 4, fifths: 1 }] } }), piece('plain'), { from: 2, to: 5 }), 'VARIANT_TIMELINE', 'a key change');
  refused(V.splice(base, piece('plain', { spec: { key: { fifths: 1, mode: 'major' } } }), { from: 6, to: 7 }), 'VARIANT_TIMELINE', 'the key in force');
  const triple = mk({ time: [3, 4], op: 'imported', rh: bars(['C5:q D5:q E5:q'], 8).join(' | '), lh: bars(['C3:h.'], 8).join(' | ') });
  const compound = mk({ time: [6, 8], op: 'imported', rh: bars(['C5:q. E5:q.'], 8).join(' | '), lh: bars(['C3:h.'], 8).join(' | ') });
  refused(V.splice(triple, compound, { from: 2, to: 4 }), 'VARIANT_TIMELINE', 'meter');
  /* a multi-measure rest over the passage */
  const multi = F.edit(base, doc => { doc.timeline.measures[1].multiRest = 4; });
  refused(V.splice(multi, piece('plain'), { from: 2, to: 4 }), 'VARIANT_TIMELINE', 'multi-measure rest');
});

check('staves: a variant with more staves than the piece, or the other hand on a staff, is refused; a variant on one staff leaves the other empty', V => {
  const two = piece('busy'), one = mk({ time: [4, 4], op: 'imported', rh: bars(F.PLAIN_RH, 8).join(' | ') });
  refused(V.splice(one, piece('plain'), { from: 2, to: 5 }), 'VARIANT_STAVES', 'more staves in the variant');
  const swapped = F.edit(piece('plain'), doc => { doc.parts[0].staves[0].limb = 'LH'; doc.parts[0].staves[1].limb = 'RH'; });
  refused(V.splice(two, swapped, { from: 2, to: 5 }), 'VARIANT_STAVES', 'the other hand');
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(two, one, o), 'one staff into two');
  const lower = render(res.graph)[1].split(' | ');
  assert.equal(lower[1], render(two)[1].split(' | ')[1]);
  assert.equal(lower[3], '', 'the lower staff has nothing in the range');
  clean(two, one, res, null, o);
});

check('a second keyboard part is not guessed at (VARIANT_PARTS)', V => {
  const base = piece('busy');
  const two = F.edit(base, (doc, h) => {
    const p = JSON.parse(JSON.stringify(doc.parts[0]));
    const remap = new Map();
    const fresh = (old, prefix) => { const n = prefix + (doc.nextId++); remap.set(old, n); return n; };
    p.id = fresh(p.id, 'p');
    p.staves.forEach(s => { s.id = fresh(s.id, 'st'); });
    p.voices.forEach(v => { v.id = fresh(v.id, 'v'); v.staff = remap.get(v.staff); });
    p.clefs.forEach(c => { c.id = fresh(c.id, 'c'); c.staff = remap.get(c.staff); });
    p.events.forEach(e => { e.id = fresh(e.id, 'e'); e.voice = remap.get(e.voice); e.staff = remap.get(e.staff); (e.heads || []).forEach(x => { x.id = fresh(x.id, 'h'); }); });
    p.spanners = []; p.directions = [];
    doc.parts.push(p);
  });
  assert.equal(two.parts.length, 2);
  refused(V.splice(two, piece('plain'), { from: 2, to: 5 }), 'VARIANT_PARTS');
});

check('a seam that a hand cannot cross widens the range by one bar on that side (at most twice, then VARIANT_SEAM)', V => {
  const lowEighths = 'C2:8 C2:8 C2:8 C2:8 C2:8 C2:8 C2:8 C2:8', highEighths = 'C5:8 C5:8 C5:8 C5:8 C5:8 C5:8 C5:8 C5:8', highThenRest = 'C5:8 C5:8 C5:8 C5:8 r:h', lowThenRest = 'C2:8 C2:8 C2:8 C2:8 r:h';
  const highAfterRest = 'r:h C5:8 C5:8 C5:8 C5:8';
  const base = custom(BUSY, () => lowEighths);
  /* G5: a hand that goes from C2 to C5 (36 semitones) needs (36 - 14) * 0.012 s = 0.26 s; an eighth at 120 a minute is 0.25 s.
     Left: the variant's bar 3 opens on C5 an eighth after the base's C2; its bar 2 ends in a rest, so one bar more is enough. Its bar 4 ends in a rest: nothing to cross on the right */
  const v1 = custom(PLAIN, i => (i === 2 ? lowThenRest : i === 3 ? highEighths : i === 4 ? highThenRest : lowEighths));
  const r1 = ok(V.splice(base, v1, { from: 3, to: 4 }));
  assert.deepEqual(r1.widened, { left: 1, right: 0 });
  assert.deepEqual(r1.final, { from: 2, to: 4 });
  clean(base, v1, r1, null, { from: 3, to: 4 });
  /* two bars more are needed and found */
  const v2 = custom(PLAIN, i => (i === 1 ? lowThenRest : i === 2 || i === 3 ? highEighths : i === 4 ? highThenRest : lowEighths));
  const r2 = ok(V.splice(base, v2, { from: 3, to: 4 }));
  assert.deepEqual(r2.widened, { left: 2, right: 0 });
  /* three would be needed: refused */
  const v3 = custom(PLAIN, i => (i === 0 ? lowThenRest : i === 1 || i === 2 || i === 3 ? highEighths : i === 4 ? highThenRest : lowEighths));
  const rr = refused(V.splice(base, v3, { from: 3, to: 4 }), 'VARIANT_SEAM');
  assert.ok(HANGUL.test(rr.message));
  /* right: the variant's bar 4 ends on C5, the base's bar 5 opens on C2; the variant's bar 5 ends in a rest. Its bar 3 opens after a rest: nothing to cross on the left */
  const v4 = custom(PLAIN, i => (i === 3 ? highAfterRest : i === 4 ? highEighths : i === 5 ? highThenRest : lowEighths));
  const r4 = ok(V.splice(base, v4, { from: 3, to: 4 }));
  assert.deepEqual(r4.widened, { left: 0, right: 1 });
  assert.deepEqual(r4.final, { from: 3, to: 5 });
  clean(base, v4, r4, null, { from: 3, to: 4 });
  /* and both sides at once */
  const v5 = custom(PLAIN, i => (i === 2 ? lowThenRest : i === 3 || i === 4 ? highEighths : i === 5 ? highThenRest : lowEighths));
  const r5 = ok(V.splice(base, v5, { from: 3, to: 4 }));
  assert.deepEqual(r5.widened, { left: 1, right: 1 });
});

check('a variant that has a hard violation of its own in the range is VARIANT_HARD', V => {
  const base = piece('busy');
  const wide = custom(PLAIN, i => (i === 3 ? 'C2+C4:w' : PLAIN_L(i)));
  const res = refused(V.splice(base, wide, { from: 2, to: 5, profile: 'large' }), 'VARIANT_HARD');
  assert.ok(/hard violation/.test(res.detail));
  ok(V.splice(base, wide, { from: 5, to: 6, profile: 'large' }), 'the same variant, a passage without the chord');
});

check('easier needs the passage to get easier by the margin, harder needs it to get harder', V => {
  const busy = piece('busy'), plain = piece('plain');
  const wrong = refused(V.splice(plain, busy, { from: 2, to: 5 }), 'VARIANT_NOT_EASIER');
  assert.ok(HANGUL.test(wrong.message) && wrong.alternative.tempoPercent === 70);
  const harder = ok(V.splice(plain, busy, { from: 2, to: 5, direction: 'harder' }));
  assert.ok(harder.judge.delta >= V.JUDGE_MARGIN);
  clean(plain, busy, harder, { direction: 'harder' }, { from: 2, to: 5, direction: 'harder' });
  const noWay = refused(V.splice(busy, plain, { from: 2, to: 5, direction: 'harder' }), 'VARIANT_NOT_HARDER');
  assert.ok(/더 어렵게/.test(noWay.message) && noWay.alternative.tempoPercent === 100);
  /* a change too small to count */
  const nudge = custom(i => (i === 3 ? 'C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 D6:8' : BUSY(i)), BUSY_L);
  refused(V.splice(piece('busy'), nudge, { from: 2, to: 5 }), 'VARIANT_NOT_EASIER', 'one note moved');
});

check('a hit of the notation checker that the splice introduces is VARIANT_NOTATION; strictNotation also refuses the variant\'s own', V => {
  const base = piece('busy');
  /* the variant's last range bar ends in a 16th rest and its next bar opens on a rest: no short silence between notes there. In the splice the base's next bar opens on a note */
  const intro = custom(PLAIN, i => (i === 5 ? 'C3:q C3:q C3:q C3:8 C3:16 r:16' : i === 6 ? 'r:q C3:q C3:h' : PLAIN_L(i)));
  const res = refused(V.splice(base, intro, { from: 4, to: 5 }), 'VARIANT_NOTATION');
  assert.ok(/class 1/.test(res.detail), res.detail);
  /* the variant's own short rest between two notes inside the range is not the splice's doing ... */
  const own = custom(PLAIN, i => (i === 3 ? 'C3:q C3:q C3:q C3:8 r:16 C3:16' : PLAIN_L(i)));
  ok(V.splice(base, own, { from: 2, to: 5 }), 'a hit the variant has');
  /* ... unless the caller asks for a strictly clean range */
  refused(V.splice(base, own, { from: 2, to: 5, strictNotation: true }), 'VARIANT_NOTATION', 'strict');
});

check('a variant the validator rejects once spliced is VARIANT_INVALID, not a broken score', V => {
  const base = piece('busy'), variant = JSON.parse(JSON.stringify(piece('plain')));
  const e = variant.parts[0].events.find(x => x.m === variant.timeline.measures[3].id && x.staff === variant.parts[0].staves[0].id);
  variant.parts[0].events.push(Object.assign(JSON.parse(JSON.stringify(e)), { id: 'e9990', heads: e.heads.map((h, i) => Object.assign({}, h, { id: 'h999' + i })) }));
  variant.nextId = 99999;
  const res = refused(V.splice(base, variant, { from: 2, to: 5 }), 'VARIANT_INVALID');
  assert.ok(/E-VOICE-OVERLAP|E-OP-RESULT/.test(res.detail), res.detail);
});

check('directions: the base\'s stay (a link to a gone event is dropped), the variant\'s are added where the base has none of that kind', V => {
  let base = piece('busy');
  const inRange = F.eventAt(base, 3, '0', 0), before = F.eventAt(base, 0, '0', 0);
  base = F.addDirection(base, 3, '0', 'dynamic', { value: 'f', event: inRange.id });
  base = F.addDirection(base, 0, '0', 'dynamic', { value: 'p', event: before.id });
  base = F.addDirection(base, 6, '0', 'words', { text: 'dolce' });
  let variant = F.addDirection(piece('plain'), 4, '0', 'dynamic', { value: 'mp' });
  variant = F.addDirection(variant, 4, '1/2', 'words', { text: 'legato' });
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  const d = res.graph.parts[0].directions;
  assert.equal(d.length, 4);
  const f = d.find(x => x.value === 'f');
  assert.ok(f && f.event === undefined, 'the dynamic stayed and lost its link to the gone note');
  assert.ok(d.find(x => x.value === 'p' && x.event === before.id), 'a direction outside is as it was');
  assert.ok(!d.find(x => x.value === 'mp'), 'the variant\'s dynamic is not added: the base has one there');
  assert.ok(d.find(x => x.text === 'legato'), 'the variant\'s words came in');
  assert.equal(res.stats.directionsKept, 1);
  assert.equal(res.stats.directionsCopied, 1);
  clean(base, variant, res, null, o);
});

check('voices: a variant voice takes the base voice of its staff, a second voice adds one', V => {
  const base = piece('busy');
  const variant = custom(PLAIN, PLAIN_L, { rh2: bars(['G4:w'], 8).join(' | ') });
  assert.equal(variant.parts[0].voices.length, 3);
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  const p = res.graph.parts[0];
  assert.equal(p.voices.length, 3, 'one voice was added');
  assert.equal(res.stats.voicesAdded, 1);
  const added = p.voices[p.voices.length - 1];
  assert.equal(added.staff, p.staves[0].id);
  assert.equal(added.label, '2');
  assert.equal(p.events.filter(e => e.voice === added.id).length, 4);
  clean(base, variant, res, null, o);
  /* the base's own voices keep their ids and their events outside the range */
  base.parts[0].voices.forEach(v => assert.ok(p.voices.some(x => JSON.stringify(x) === JSON.stringify(v))));
});

check('the performance layer of a recording keeps its notes; those of the gone heads lose their link', V => {
  const base = piece('busy', { spec: { perf: true } }), variant = piece('plain');
  const gone = new Set();
  base.parts[0].events.forEach(e => { if (base.timeline.measures.slice(2, 6).some(m => m.id === e.m)) e.heads.forEach(h => gone.add(h.id)); });
  const res = ok(V.splice(base, variant, { from: 2, to: 5 }));
  const pf = res.graph.performances[0], was = base.performances[0];
  assert.equal(pf.notes.length, was.notes.length);
  pf.notes.forEach((pn, i) => {
    if (gone.has(was.notes[i].link)) assert.equal(pn.link, undefined, 'a link to a gone head is dropped');
    else assert.equal(pn.link, was.notes[i].link, 'the other links stay');
  });
  assert.ok(pf.notes.some(pn => pn.link === undefined) && pf.notes.some(pn => pn.link !== undefined));
});

check('tuplets, grace notes and ties of the variant come in; repeat signs and the tempo outside are untouched', V => {
  const base = F.edit(piece('busy'), doc => {
    doc.timeline.measures[0].barline = { left: { repeat: 'forward' } };
    doc.timeline.measures[6].barline = { right: { repeat: 'backward' } };
  });
  const variant = custom(i => (i === 3 ? '3e[ C5:8 D5:8 E5:8] F5:q G5:h' : PLAIN(i)), PLAIN_L, { graces: [{ staff: 0, bar: 4, at: '0', pitch: 'D5' }] });
  const o = { from: 2, to: 5 };
  const res = ok(V.splice(base, variant, o));
  const p = res.graph.parts[0];
  assert.equal(spans(res.graph, 'tuplet').length, 1);
  assert.equal(spans(res.graph, 'tuplet')[0].events.length, 3);
  assert.equal(p.events.filter(e => e.grace).length, 1);
  assert.equal(JSON.stringify(res.graph.timeline), JSON.stringify(base.timeline));
  assert.equal(T.unroll(res.graph).length, T.unroll(base).length);
  clean(base, variant, res, null, o);
});

check('the passage at the edges of the piece, and one bar alone', V => {
  const base = piece('busy'), variant = piece('plain');
  [[0, 3], [4, 7], [0, 7], [3, 3], [0, 0], [7, 7]].forEach(([from, to]) => {
    const o = { from: from, to: to };
    const res = ok(V.splice(base, variant, o), 'bars ' + from + '-' + to);
    assert.deepEqual(res.final, { from: from, to: to });
    clean(base, variant, res, null, o);
  });
});

check('at the end of the piece there is no seam to mend: an open pedal and a clef stay as they were', V => {
  const open = F.edit(F.addClef(piece('busy'), 1, 5, 'G'), (doc, h) => { h.part.spanners.push({ id: h.id('s'), type: 'pedal', pedal: 'damper', from: { m: h.bars[5], at: '0' } }); });
  const variant = piece('plain'), o = { from: 6, to: 7 };
  const res = ok(V.splice(open, variant, o));
  const ped = spans(res.graph, 'pedal');
  assert.equal(ped.length, 1);
  assert.deepEqual(ped[0].to, { m: open.timeline.measures[5].id, at: '1' }, 'the pedal ends where the range begins');
  clean(open, variant, res, null, o);
  /* an open pedal over the range is not a reason to refuse: it lasts on both sides */
  const open2 = F.edit(piece('busy'), (doc, h) => { h.part.spanners.push({ id: h.id('s'), type: 'pedal', pedal: 'damper', from: { m: h.bars[0], at: '0' } }); });
  const r2 = ok(V.splice(open2, variant, { from: 2, to: 5 }));
  assert.equal(spans(r2.graph, 'pedal').length, 2);
  clean(open2, variant, r2, null, { from: 2, to: 5 });
});

check('the same notes on the other staff are not "the same"', V => {
  const upper = mk({ time: [4, 4], op: 'imported', rh: bars(['C5:w'], 8).join(' | '), lh: bars(['r:w'], 8).join(' | ') });
  const lower = mk({ time: [4, 4], op: 'imported', rh: bars(['r:w'], 8).join(' | '), lh: bars(['C5:w'], 8).join(' | ') });
  const res = V.splice(upper, lower, { from: 2, to: 5 });
  assert.notEqual(res.reason, 'VARIANT_IDENTICAL');
});

check('the same call gives the same graph, the inputs are not changed, the result is frozen', V => {
  const base = piece('busy'), variant = piece('plain');
  const before = SG.serialize(base) + SG.serialize(variant);
  const a = ok(V.splice(base, variant, { from: 2, to: 5, songId: 's', level: 'beginner' })), b = V.splice(base, variant, { from: 2, to: 5, songId: 's', level: 'beginner' });
  assert.equal(SG.serialize(a.graph), SG.serialize(b.graph));
  assert.equal(SG.serialize(base) + SG.serialize(variant), before);
  assert.ok(Object.isFrozen(a.graph));
  assert.notEqual(a.graph, base);
});

check('bad arguments are VARIANT_ARGS with a Korean sentence and no alternative; every refusal has a reason code', V => {
  const base = piece('busy'), variant = piece('plain');
  [[{ from: 5, to: 2 }], [{ from: -1, to: 2 }], [{ from: 2, to: 8 }], [{ from: 1.5, to: 3 }], [{ from: 2, to: 5, direction: 'sideways' }], [{}]].forEach(([o]) => {
    const r = refused(V.splice(base, variant, o), 'VARIANT_ARGS', JSON.stringify(o));
    assert.ok(HANGUL.test(r.message) && r.alternative === undefined);
  });
  refused(V.splice(null, variant, { from: 0, to: 1 }), 'VARIANT_ARGS');
  refused(V.splice(base, { timeline: {} }, { from: 0, to: 1 }), 'VARIANT_ARGS');
  assert.ok(V.CODES.indexOf('VARIANT_IDENTICAL') >= 0 && V.CODES.indexOf('VARIANT_SEAM') >= 0);
  V.CODES.forEach(c => assert.ok(c.indexOf('VARIANT_') === 0));
});

module.exports = { CHECKS, setFast };
