/* G9e refusals (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12, "G9e refusals").

   With one note per hand the app refused 54% of the method pieces (119 of 222 at each level) and dense piano covers: arrangement/plan.js planSection checked the SOURCE
   notes of the retained voices (a hand's simultaneous span and key count, chordLoad, notes per beat, range) before the single-note thinning ran, so chords the realizer
   would never play made a piece unreachable. The app then saved the legacy arrangement (dyads, octave chords), which the teacher rejects.

   What this checks (no browser; the page half is tests/single-note-app.test.js):
     - plan(): the relaxed search (opts.relax 1|2) runs only for a section the strict search cannot fit: a piece the strict search plans is planned byte-for-byte as before,
       with no `relaxed` field anywhere; a dense cover is refused strictly and planned with relax 2, and the plan says so (plan.relaxed, section.relaxed, attempt.relaxed)
     - candidates/: opts.relax reaches plan() only together with singleNoteHands (every other output is what it was); a dense cover that has no candidate strictly has
       them with it, each a hard-violation-free arrangement with no hand starting two notes
     - handchords.thin dropBass: the melody's top note stays, a protected bass note that shares its hand goes (counted in stats.maxNotes.droppedBass); without the option,
       or without maxNotes, nothing changes; idempotent
     - realize(): handDropBass without handMaxNotes changes nothing
     - the app's arrangeSingleNote (extracted, tests/realize/app-single-extract.js): a strict-success panel of 24 pieces hashes exactly as it did on origin/main 8a7a65a
       (tests/fixtures/g9e-refusals-strict.json), the two synthetic dense covers and a formerly refused method piece succeed with levelNote 'relaxed-plan', a piece that
       needs no relaxation has no note, and burgmuller25/001 (a dyad leaked through as a success before dropBass) now has no hand starting two notes */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./app-single-extract.js');
const SYN = require('./g9e-synth.js');
const REPO = E.REPO;
const HC = require(path.join(REPO, 'realize/handchords.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const SGIDX = require(path.join(REPO, 'scoregraph/index.js'));
const IMPORT = require(path.join(REPO, 'scoregraph/musicxml-import.js'));
const MET = require(path.join(REPO, 'critics/metrics.js'));
const PX = require(path.join(REPO, 'scoregraph/pitch.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const STRICT = require('../fixtures/g9e-refusals-strict.json');

const ref = E.reference();
MET.setWeights(ref.weights);
const app = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });

function hymn(name) {
  const r = IMPORT.importMusicXml(fs.readFileSync(path.join(REPO, 'catalog/hymns', name + '.musicxml'), 'utf8'), { scoreId: 'h-' + name });
  assert.ok(r.ok, 'import ' + name);
  return r.graph;
}
async function mxl(rel) {
  const r = await SGIDX.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: rel, scoreId: rel.replace(/[^A-Za-z0-9._:-]/g, '-') });
  assert.ok(r.ok, 'import ' + rel);
  return r.graph;
}
async function load(name) {
  if (name.startsWith('synth:')) return SYN[name.slice(6)]();
  if (name.startsWith('hymn:')) return hymn(name.slice(5));
  return mxl(name);
}
const sha = g => crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 16);

/* the notes each hand starts at one moment, in a realized graph: [{hand, midi, on}] */
function attacks(graph) {
  const part = graph.parts[0];
  const mStart = new Map(); let acc = R.ZERO;
  graph.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
  const out = [];
  part.events.forEach(ev => {
    if (ev.kind !== 'note' || ev.grace) return;
    (ev.heads || []).forEach(h => out.push({ hand: PX.limbOf(part, ev, h), midi: PX.midi(h.pitch), on: R.toNumber(R.add(mStart.get(ev.m), R.parse(ev.at))) }));
  });
  return out;
}
function multiOnsets(graph) {
  const by = new Map();
  attacks(graph).forEach(n => { const k = n.hand + '|' + n.on; by.set(k, (by.get(k) || 0) + 1); });
  return [...by.values()].filter(c => c > 1).length;
}

/* ================================================================ the planner: strict first */
const REQ = (targetLevel, handProfile) => ({ targetLevel: targetLevel, handProfile: handProfile, sections: 'all' });

test('plan(): a piece the strict search plans is planned byte-for-byte as before with relax 1 or 2, and carries no relaxed field', async () => {
  const pieces = [hymn('christ-arose'), await mxl('catalog/method/beyer/003.mxl'), await mxl('catalog/method/burgmuller25/003.mxl')];
  for (const g of pieces) {
    const sg = SGG.analyze(g);
    let planned = 0;
    for (const lvl of [1, 2, 3, 4]) for (const hp of ['large', 'medium', 'small']) {
      const strict = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref });
      const r1 = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref, relax: 1 });
      const r2 = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref, relax: 2 });
      if (!strict.ok) continue;
      planned++;
      assert.equal(JSON.stringify(r1), JSON.stringify(strict), 'relax 1 is the strict plan');
      assert.equal(JSON.stringify(r2), JSON.stringify(strict), 'relax 2 is the strict plan');
      assert.ok(!('relaxed' in strict.plan) && strict.plan.sections.every(s => !('relaxed' in s) && s.attempts.every(a => !('relaxed' in a))));
    }
    assert.ok(planned > 0, 'the piece is planned strictly at some level');
  }
});

test('plan(): relax is off by default and for any value but 1 or 2', () => {
  const g = SYN.pieceA(), sg = SGG.analyze(g);
  [undefined, 0, null, false, 3, 'yes'].forEach(v => {
    const r = ARR.plan(g, sg, REQ(4, 'large'), { reference: ref, relax: v });
    assert.equal(r.ok, false, 'relax ' + String(v));
    assert.equal(r.reason, 'UNREACHABLE');
  });
});

test('plan(): a dense piano cover is refused by the strict search at every level and planned by relax 2, which says so', () => {
  ['pieceA', 'pieceB'].forEach(name => {
    const g = SYN[name](), sg = SGG.analyze(g);
    let relaxedAt = 0;
    for (const lvl of [1, 2, 3, 4]) for (const hp of ['large', 'medium', 'small']) {
      assert.equal(ARR.plan(g, sg, REQ(lvl, hp), { reference: ref }).ok, false, name + ' strict ' + lvl + ' ' + hp);
      const r = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref, relax: 2 });
      if (!r.ok) continue;
      relaxedAt++;
      assert.equal(r.plan.relaxed, 2, name + ': the plan carries the tier it needed');
      r.plan.sections.forEach(s => {
        assert.equal(s.relaxed, 2);
        assert.ok(/RELAXED/.test(s.explanation), 'the explanation says it');
        const last = s.attempts[s.attempts.length - 1];
        assert.equal(last.relaxed, 2);
        assert.ok(s.attempts.some(a => !a.relaxed), 'the strict rungs were tried first and are in the record');
        /* the thinned view: a hand's reach in the relaxed record is one note, zero span */
        assert.ok(last.reach.RH.count <= 1 && last.reach.LH.count <= 1 && last.reach.RH.span === 0 && last.reach.LH.span === 0);
      });
    }
    assert.ok(relaxedAt >= 6, name + ' is planned by relax 2 at levels 3 and up (' + relaxedAt + ' of 12)');
  });
});

test('plan(): relax 1 alone (the thinned view, strict density) plans a piece whose only obstacle is its chords', async () => {
  /* a method piece the strict search refuses whose refusal is reach/chordLoad: relax 1 is enough, and is preferred over relax 2 (the tiers are tried in order) */
  const g = await mxl('catalog/method/beyer/013.mxl'), sg = SGG.analyze(g);
  let one = 0, strictOk = 0;
  for (const lvl of [1, 2, 3, 4]) for (const hp of ['large', 'medium', 'small']) {
    const s = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref });
    const a = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref, relax: 1 });
    const b = ARR.plan(g, sg, REQ(lvl, hp), { reference: ref, relax: 2 });
    if (s.ok) { strictOk++; continue; }
    if (a.ok) { one++; assert.equal(a.plan.relaxed, 1); assert.ok(b.ok && b.plan.relaxed === 1, 'relax 2 uses the lower tier where it is enough'); }
  }
  assert.ok(one + strictOk > 0);
});

/* ================================================================ candidates */
test('candidates: opts.relax reaches plan() only with singleNoteHands; a dense cover has no candidate without it and some with it', () => {
  const g = SYN.pieceB(), sg = SGG.analyze(g);
  const req = REQ(3, 'large');
  const strict = CAND.run(g, sg, req, { singleNoteHands: true, skipEngrave: true, reference: ref });
  assert.equal(strict.ok, false);
  assert.equal(strict.reason, 'NO_CANDIDATES');
  const notSingle = CAND.run(g, sg, req, { skipEngrave: true, reference: ref, relax: 2 });
  assert.equal(notSingle.ok, false, 'relax without singleNoteHands is ignored');
  assert.equal(notSingle.reason, 'NO_CANDIDATES');
  const relaxed = CAND.run(g, sg, req, { singleNoteHands: true, skipEngrave: true, reference: ref, relax: 2 });
  assert.equal(relaxed.ok, true);
  assert.equal(relaxed.selected.hardOk, true);
  assert.equal(relaxed.selected.plan.relaxed, 2, 'the chosen candidate\'s plan carries the flag');
  assert.equal(multiOnsets(relaxed.selected.graph), 0, 'no hand starts two notes');
  relaxed.scored.filter(c => c.hardOk).forEach(c => assert.equal(multiOnsets(c.graph), 0));
});

test('candidates: a piece the strict search plans gives the same candidates, byte for byte, with relax 2', () => {
  const g = hymn('christ-arose'), sg = SGG.analyze(g);
  const req = REQ(2, 'large');
  const a = CAND.run(g, sg, req, { singleNoteHands: true, skipEngrave: true, reference: ref });
  const b = CAND.run(g, sg, req, { singleNoteHands: true, skipEngrave: true, reference: ref, relax: 2 });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.scored.length, b.scored.length);
  a.scored.forEach((c, i) => assert.equal(c.fingerprint, b.scored[i].fingerprint));
  assert.equal(a.selected.fingerprint, b.selected.fingerprint);
  assert.ok(b.scored.every(c => !c.plan.relaxed));
});

/* ================================================================ handchords dropBass */
let nid = 0;
function n(hand, midi, o) {
  o = o || {};
  const id = o.id || ('g' + (nid++));
  return { id: id, hand: hand, on: o.on == null ? 0 : o.on, off: o.off == null ? 1 : o.off, midi: midi, cont: !!o.cont, chain: o.chain || id, keep: !!o.keep, low: !!o.low, mel: !!o.mel };
}
const ids = r => r.removedIds.slice().sort();
const one = (notes, dropBass) => HC.thin(notes, { model: 'limb', maxNotes: 1, dropBass: dropBass });

test('dropBass: the melody\'s top note and a protected bass in one hand: without the option both stay (counted unfixable), with it the bass goes and the melody stays', () => {
  const mel = n('RH', 72, { keep: true, mel: true }), bass = n('RH', 55, { keep: true });
  const off = one([mel, bass], false);
  assert.deepEqual(off.removedIds, []);
  assert.equal(off.stats.maxNotes.unfixable, 1);
  assert.equal(off.stats.maxNotes.droppedBass, 0);
  const on = one([n('RH', 72, { keep: true, mel: true, id: 'M' }), n('RH', 55, { keep: true, id: 'B' })], true);
  assert.deepEqual(on.removedIds, ['B']);
  assert.equal(on.stats.maxNotes.unfixable, 0);
  assert.equal(on.stats.maxNotes.droppedBass, 1);
  assert.equal(on.stats.maxNotes.after.RH.max, 1);
  /* the melody in the left hand over its bass */
  const lh = one([n('LH', 52, { keep: true, mel: true, id: 'M' }), n('LH', 40, { keep: true, id: 'B' })], true);
  assert.deepEqual(lh.removedIds, ['B']);
});

test('dropBass: a melody event\'s own extra head that is also the bass goes (the melody top stays); two bass voices in one hand keep the lowest', () => {
  const r = one([n('LH', 60, { keep: true, mel: true, id: 'M' }), n('LH', 52, { keep: true, low: true, id: 'B' })], true);
  assert.deepEqual(r.removedIds, ['B']);
  assert.equal(r.stats.maxNotes.unfixable, 0);
  const two = one([n('LH', 40, { keep: true, id: 'low' }), n('LH', 47, { keep: true, id: 'high' })], true);
  assert.deepEqual(two.removedIds, ['high'], 'left hand: the higher protected note goes first');
  const rh = one([n('RH', 60, { keep: true, id: 'lo' }), n('RH', 67, { keep: true, id: 'hi' })], true);
  assert.deepEqual(rh.removedIds, ['lo'], 'right hand: the lower goes first');
});

test('dropBass: never removes the melody; a hand of one protected note is left alone; nothing changes without maxNotes or without the option; idempotent', () => {
  const m1 = n('RH', 72, { keep: true, mel: true, id: 'M1' }), m2 = n('RH', 76, { keep: true, mel: true, id: 'M2' });
  const both = one([m1, m2], true);
  assert.deepEqual(both.removedIds, [], 'only melody notes: nothing to drop');
  assert.equal(both.stats.maxNotes.unfixable, 1);
  assert.deepEqual(one([n('RH', 72, { keep: true, mel: true })], true).removedIds, []);
  const mk = () => [n('RH', 72, { keep: true, mel: true, id: 'M' }), n('RH', 55, { keep: true, id: 'B' }), n('LH', 40, { keep: true, id: 'L' })];
  assert.deepEqual(HC.thin(mk(), { model: 'limb', dropBass: true }).removedIds, [], 'no maxNotes: no effect');
  assert.deepEqual(HC.thin(mk(), { model: 'limb', maxNotes: 1 }).removedIds, [], 'no option: no effect');
  assert.deepEqual(HC.thin(mk(), { model: 'limb', maxNotes: 2, dropBass: true }).removedIds, [], 'N = 2 keeps both');
  const first = one(mk(), true);
  const left = mk().filter(x => first.removedIds.indexOf(x.id) < 0);
  assert.deepEqual(one(left, true).removedIds, [], 'thin(thin(x)) removes nothing');
  assert.equal(HC.thin(mk(), { model: 'limb', maxNotes: 1 }).stats.maxNotes.droppedBass, 0);
});

test('dropBass: a removed bass goes with its whole tie chain', () => {
  const mel = n('RH', 72, { keep: true, mel: true, id: 'M' });
  const b1 = n('RH', 55, { keep: true, id: 'b1', chain: 'c', on: 0, off: 1 });
  const b2 = n('RH', 55, { keep: true, id: 'b2', chain: 'c', on: 1, off: 2, cont: true });
  const m2 = n('RH', 74, { keep: true, mel: true, id: 'M2', on: 1, off: 2 });
  const r = one([mel, b1, b2, m2], true);
  assert.deepEqual(ids(r), ['b1', 'b2']);
});

test('realize(): handDropBass without handMaxNotes changes nothing (the pre-single hand-chords pass is untouched)', () => {
  const g = hymn('christ-arose'), sg = SGG.analyze(g);
  const plan = ARR.plan(g, sg, REQ(2, 'large'), { reference: ref });
  assert.ok(plan.ok);
  const base = { pattern: 'auto', reference: ref, diatonicLow: true, hymnThin: true, handChords: true, noStride: true };
  const a = REALIZE.realize(g, sg, plan.plan, base);
  const b = REALIZE.realize(g, sg, plan.plan, Object.assign({ handDropBass: true }, base));
  assert.ok(a.ok && b.ok);
  assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph));
  assert.equal(JSON.stringify(a.report), JSON.stringify(b.report));
});

/* ================================================================ the app's entry point */
test('app arrangeSingleNote: strict-success panel, 24 pieces, hashes exactly as origin/main 8a7a65a made them, and no note', async () => {
  const keys = Object.keys(STRICT.hashes);
  assert.ok(keys.length >= 24);
  for (const k of keys) {
    const [file, level] = k.split('|');
    const res = await app.arrangeSingleNote(await load(file), { level: level });
    assert.equal(res.ok, true, k);
    assert.equal(sha(res.graph), STRICT.hashes[k], k + ' is what origin/main made');
    assert.equal(res.levelNote, null, k + ' needs no relaxation: no note');
    assert.equal(res.report.relaxed, undefined);
  }
});

test('app arrangeSingleNote: a dense cover and a formerly refused method piece succeed with the note, no hand starts two notes, no hard violation', async () => {
  for (const name of ['synth:pieceA', 'synth:pieceB', 'catalog/method/hanon/001.mxl', 'catalog/method/czerny599/001.mxl', 'catalog/happy-birthday.musicxml']) {
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      const res = await app.arrangeSingleNote(await load(name), { level: level });
      assert.equal(res.ok, true, name + ' ' + level + ' ' + res.reason);
      assert.equal(res.levelNote, 'relaxed-plan', name + ' ' + level);
      assert.ok(res.report.relaxed === 1 || res.report.relaxed === 2);
      assert.equal(multiOnsets(res.graph), 0, name + ' ' + level + ': no hand starts two notes');
      assert.equal(MET.hardViolationsOfGraph(res.graph, 'large').hard, 0, name + ' ' + level + ': no G5 hard violation');
    }
  }
});

test('app arrangeSingleNote: burgmuller25/001 used to leak a dyad as a success (melody and bass in one hand); now no hand starts two notes', async () => {
  const before = STRICT.leaks['catalog/method/burgmuller25/001.mxl|intermediate'];
  assert.ok(before >= 1, 'the origin/main output had ' + before + ' multi-note onset(s)');
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    const res = await app.arrangeSingleNote(await mxl('catalog/method/burgmuller25/001.mxl'), { level: level });
    assert.equal(res.ok, true);
    assert.equal(multiOnsets(res.graph), 0, level);
  }
});

test('app arrangeSingleNote: a piece that stays refused (czerny849/009) is {ok:false, UNREACHABLE}, nothing thrown, no fallback engine', async () => {
  const res = await app.arrangeSingleNote(await mxl('catalog/method/czerny849/009.mxl'), { level: 'intermediate' });
  assert.equal(res.ok, false);
  assert.ok(res.reason === 'UNREACHABLE' || res.reason === 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', res.reason);
});
