/* arrangement/plan.js + texture.js: the search itself, over real hymn corpus material
   (the richest SongGraph ground truth per G7a's own record) plus a couple of clean
   synthetic fixtures for the texture ladder in isolation. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SGG, AP, PLAN, TEX, importCorpus, mk } = require('./helpers.js');

test('texture ladder: a 4-voice part gives full -> partial -> reduced, dropping the least confident inner voice first', () => {
  const g = mk({
    time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | G6:h E6:h', rh2: 'A5:q A5:q A5:q A5:q | G5:h G5:h',
    lh: 'E4:q E4:q E4:q E4:q | E4:h E4:h', lh2: 'C3:q C3:q C3:q C3:q | C3:h C3:h'
  });
  const sg = SGG.analyze(g);
  const part = g.parts[0];
  const roles = sg.voiceRoles.parts.find(p => p.part === part.id).roles;
  const ladder = TEX.ladder(roles, sg.melodyBass.parts.find(p => p.part === part.id));
  assert.equal(ladder.length, 3, 'melody+bass+2 inner voices should give 3 rungs');
  assert.deepEqual(ladder.map(r => r.tier), ['full', 'partial', 'reduced']);
  assert.deepEqual(ladder.map(r => r.extraKept), [2, 1, 0]);
  assert.equal(ladder[2].voiceIds.length, 2, 'the reduced rung keeps exactly melody+bass');
});

test('texture ladder: a 2-voice part has exactly one rung (melody+bass IS the full texture)', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q', lh: 'C3:h C3:h' });
  const sg = SGG.analyze(g);
  const part = g.parts[0];
  const roles = sg.voiceRoles.parts.find(p => p.part === part.id).roles;
  const ladder = TEX.ladder(roles, sg.melodyBass.parts.find(p => p.part === part.id));
  assert.equal(ladder.length, 1);
  assert.equal(ladder[0].extraKept, 0);
});

test('rungsFrom: startExtraForStage caps ambition by requested stage, never escalates past what a piece has', () => {
  assert.equal(TEX.startExtraForStage(1), 0);
  assert.equal(TEX.startExtraForStage(2), 1);
  assert.equal(TEX.startExtraForStage(3), Infinity);
  const fullLadder = [{ tier: 'full', extraKept: 2, voiceIds: [] }, { tier: 'partial', extraKept: 1, voiceIds: [] }, { tier: 'reduced', extraKept: 0, voiceIds: [] }];
  assert.deepEqual(TEX.rungsFrom(fullLadder, 0).map(r => r.extraKept), [0]);
  assert.deepEqual(TEX.rungsFrom(fullLadder, 1).map(r => r.extraKept), [1, 0]);
  assert.deepEqual(TEX.rungsFrom(fullLadder, Infinity).map(r => r.extraKept), [2, 1, 0]);
});

test('plan(): a clean hymn at a moderate level and profile produces an ok plan with a real explanation', async () => {
  const rows = await importCorpus(['catalog/hymns/o-come-emmanuel.musicxml']);
  assert.ok(rows[0].ok);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const res = AP.plan(g, sg, { targetLevel: 2.5, handProfile: 'medium' });
  assert.ok(res.ok, 'expected an ok plan: ' + JSON.stringify(res).slice(0, 300));
  assert.ok(res.plan.sections.length >= 1);
  res.plan.sections.forEach(s => {
    assert.ok(s.explanation.length > 20, 'every section needs a real, non-generic explanation');
    assert.ok(s.explanation.indexOf('Section ' + s.section.label) === 0);
    assert.ok(/register/.test(s.explanation) && /span/.test(s.explanation), 'explanation should cite real register/span numbers');
  });
});

test('plan(): asking for a level far too low for a wide-range hymn fails cleanly with UNREACHABLE, not a bad plan', async () => {
  const rows = await importCorpus(['catalog/hymns/amazing-grace.musicxml']);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const res = AP.plan(g, sg, { targetLevel: 1.0, handProfile: 'medium' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'UNREACHABLE');
});

test('plan(): the same request over the same graph is deterministic byte-for-byte', async () => {
  const rows = await importCorpus(['catalog/hymns/amazing-grace.musicxml']);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const req = { targetLevel: 2.5, handProfile: 'medium' };
  const a = JSON.stringify(AP.plan(g, sg, req));
  const b = JSON.stringify(AP.plan(g, sg, req));
  assert.equal(a, b);
});

test('plan(): request validation rejects a non-numeric targetLevel and an unknown hand profile', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' });
  const sg = SGG.analyze(g);
  const bad1 = AP.plan(g, sg, { targetLevel: 'hard', handProfile: 'medium' });
  assert.equal(bad1.ok, false); assert.equal(bad1.reason, 'BAD_REQUEST');
  const bad2 = AP.plan(g, sg, { targetLevel: 1.5, handProfile: 'giant' });
  assert.equal(bad2.ok, false); assert.equal(bad2.reason, 'BAD_REQUEST');
});

test('plan(): request.sections filters to named G7a sections, and an unknown section name fails cleanly', async () => {
  const rows = await importCorpus(['catalog/hymns/o-come-emmanuel.musicxml']);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const all = AP.plan(g, sg, { targetLevel: 2.5, handProfile: 'medium' });
  assert.ok(all.ok);
  const labels = sg.sections.map(s => s.label);
  const one = AP.plan(g, sg, { targetLevel: 2.5, handProfile: 'medium', sections: [labels[0]] });
  assert.ok(one.ok);
  assert.equal(one.plan.sections.length, 1);
  const none = AP.plan(g, sg, { targetLevel: 2.5, handProfile: 'medium', sections: ['not-a-real-label'] });
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'NO_SECTIONS');
});
