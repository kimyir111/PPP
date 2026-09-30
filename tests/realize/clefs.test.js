/* realize/clefs.js (G9e-lite): the lower staff's clef per measure, moved out of review/lib/neutral.js so the app and the review packets
   share one rule. The rule's own tests are tests/review/neutral.test.js (unchanged); here: the graph step the app runs before the 8va pass. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..', '..');
const CL = require(path.join(REPO, 'realize/clefs.js'));
const OTT = require(path.join(REPO, 'realize/ottava.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const LS = require(path.join(REPO, 'scoregraph/legacy-score.js'));
const NEUTRAL = require(path.join(REPO, 'review/lib/neutral.js'));
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));

const clefsOf = (g, n) => { const p = g.parts[0], st = p.staves[n]; return p.clefs.filter(c => c.staff === st.id).map(c => g.timeline.measures.findIndex(m => m.id === c.m) + 1 + ':' + c.sign); };
const soundingNotes = g => JSON.stringify(g.parts[0].events.filter(e => e.kind === 'note').map(e => [e.m, e.at, e.dur, e.staff, (e.heads || []).map(h => h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct)]));

test('the review tool and the app share one implementation, and the constants are the documented ones', () => {
  assert.equal(NEUTRAL.lowerClefs, CL.lowerClefs);
  assert.equal(NEUTRAL.ledgerLines, CL.ledgerLines);
  assert.deepEqual([NEUTRAL.CLEF_SAVE_SHARE, NEUTRAL.CLEF_SAVE_MIN, NEUTRAL.CLEF_MIN_RUN], [0.5, 4, 2]);
});

test('a left hand that lies in the treble register gets a treble clef on the lower staff, and the notes are untouched', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q',
    lh: 'C5:q D5:q E5:q G5:q | C5:q D5:q E5:q G5:q | C5:q D5:q E5:q G5:q' });
  assert.deepEqual(clefsOf(g, 1), ['1:F'], 'the test graph starts with the realizer\'s bass clef, or none');
  const r = CL.applyLowerClefs(g);
  assert.equal(r.changed, true);
  assert.deepEqual(clefsOf(r.graph, 1), ['1:G']);
  assert.deepEqual(r.clefs, ['treble', 'treble', 'treble']);
  assert.equal(soundingNotes(r.graph), soundingNotes(g), 'only the clef moved');
  assert.deepEqual(clefsOf(r.graph, 0), clefsOf(g, 0), 'the upper staff is not touched');
  const again = CL.applyLowerClefs(r.graph);
  assert.deepEqual(clefsOf(again.graph, 1), ['1:G'], 'idempotent');
});

test('a low left hand keeps the bass clef, and the graph itself comes back', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | C5:q D5:q E5:q F5:q', lh: 'C3:q G2:q C3:q G2:q | C3:q G2:q C3:q G2:q' });
  const r = CL.applyLowerClefs(g);
  assert.equal(r.changed, false);
  assert.equal(r.graph, g);
});

test('the clef goes in before the 8va pass, which then judges against the clef that is drawn: no 8va over a treble-clef staff that holds its notes on the staff', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q',
    lh: 'C5:w | C5:w | C5:w | C5:w' });
  const lowerOtt = gr => gr.parts[0].spanners.filter(s => s.type === 'ottava' && s.staff === gr.parts[0].staves[1].id).length;
  const before = OTT.addOttava(g).graph;
  const after = OTT.addOttava(CL.applyLowerClefs(g).graph).graph;
  assert.ok(lowerOtt(before) > 0, 'without the clef step a high left hand gets an 8va line: ' + lowerOtt(before));
  assert.equal(lowerOtt(after), 0, 'with it none');
});

test('the graph -> Score conversion carries the clef, and a change in the middle of the piece, at a barline', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q | C6:q D6:q E6:q F6:q',
    lh: 'C3:w | C3:w | C5:w | C5:w | C3:w | C3:w' });
  const r = CL.applyLowerClefs(g);
  assert.deepEqual(r.clefs, ['bass', 'bass', 'treble', 'treble', 'bass', 'bass']);
  const score = LS.toScore(r.graph, { name: 't' });
  assert.deepEqual(score.measures.map(m => m.clefs[2]), ['bass', 'bass', 'treble', 'treble', 'bass', 'bass']);
});

test('in a bare vm context (no require), clefs.js loads after ops.js and gives the same clefs', () => {
  const ctx = vm.createContext({ console }); ctx.window = ctx; ctx.globalThis = ctx;
  ['rational', 'schema', 'pitch', 'time', 'serialize', 'validate', 'build', 'prov', 'ops'].forEach(n => vm.runInContext(fs.readFileSync(path.join(REPO, 'scoregraph', n + '.js'), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(REPO, 'realize', 'clefs.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.PPPRealizeModules.clefs.applyLowerClefs, 'function');
  const notes = [{ m: 1, staff: 2, p: 'C5' }, { m: 1, staff: 2, p: 'E5' }, { m: 2, staff: 2, p: 'C5' }, { m: 2, staff: 2, p: 'D5' }];
  assert.equal(JSON.stringify(ctx.PPPRealizeModules.clefs.lowerClefs([{}, {}], notes)), JSON.stringify(CL.lowerClefs([{}, {}], notes)));
});
