/* rec/app.js (G10a-4): the page's side of the recording conversion v2: the mode switch's coercion, the flags of the bars PPP was not sure about, the
   heard performance a kept graph carries, the time map and "Play as recorded"'s plan; and that the app's loader lists the files in the order rec/index.js's header
   gives. docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6, 10 and 24.11. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, perform } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const REC = require(path.join(REPO, 'rec', 'index.js'));
const RA = require(path.join(REPO, 'rec', 'app.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const app = { title: 't', closeGaps: true, exactBars: true };
/* 4/4 at 120: per bar a bass half note, chords and a melody of eighths; deterministic */
function piece(bars, seed) {
  return perform([[0, [48, 60], 0.5], [0.5, [64], 0.5], [1, [67, 55], 1], [2, [65], 0.5], [2.5, [69], 0.5], [3, [71, 43], 1]], 4, bars, 120, { jitter: 0.012, seed: seed || 4 });
}

test('normalizeMode: only the string v2 is v2; everything else is legacy (the convention of PPP.arranger)', () => {
  assert.equal(RA.normalizeMode('v2'), 'v2');
  [undefined, null, '', 'V2', 'v1', 'legacy', 'g8', 'single', true, 1, {}, [], ' v2'].forEach(v => assert.equal(RA.normalizeMode(v), 'legacy', String(v)));
});

test('the app lists the files in the order rec/index.js\'s header gives, and the page needs no more than the header names', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
  const block = /const RECORDING_SCRIPTS = \[([\s\S]*?)\];/.exec(html)[1];
  const listed = [...block.matchAll(/'(rec\/[\w-]+\.js)'/g)].map(m => m[1]);
  const wblock = /const RECORDING_WEIGHTS = \[([\s\S]*?)\n\];/.exec(html)[1];
  const weights = [...wblock.matchAll(/\['(\w+)', '(rec\/weights\/[\w.-]+\.json)'\]/g)].map(m => [m[1], m[2]]);
  /* rec/index.js's header: the weights, then "3. attacks, beats, model, metre, hands, index" and "4. grid, voices, rests, writer, key, pedal" (audio-score.js last, the page's own script) */
  assert.deepEqual(listed, ['rec/attacks.js', 'rec/beats.js', 'rec/model.js', 'rec/metre.js', 'rec/hands.js', 'rec/index.js',
    'rec/grid.js', 'rec/voices.js', 'rec/rests.js', 'rec/writer.js', 'rec/key.js', 'rec/pedal.js', 'rec/app.js']);
  const header = fs.readFileSync(path.join(REPO, 'rec', 'index.js'), 'utf8').slice(0, 4000);
  const order = [...header.matchAll(/rec\/(attacks|beats|model|metre|hands|index|grid|voices|rests|writer|key|pedal)\.js/g)].map(m => 'rec/' + m[1] + '.js');
  const firstSeen = []; order.forEach(f => { if (firstSeen.indexOf(f) < 0) firstSeen.push(f); });
  const idx = f => listed.indexOf(f);
  /* every dependency pair the header states is in order in the app's list */
  ['attacks', 'beats', 'model', 'metre', 'hands', 'index'].reduce((a, b) => { assert.ok(idx('rec/' + a + '.js') < idx('rec/' + b + '.js'), a + ' before ' + b); return b; });
  assert.ok(idx('rec/index.js') < idx('rec/grid.js'));
  ['grid', 'voices', 'rests', 'writer', 'key', 'pedal'].reduce((a, b) => { assert.ok(idx('rec/' + a + '.js') < idx('rec/' + b + '.js'), a + ' before ' + b); return b; });
  assert.deepEqual(weights.map(w => w[0]), ['PPPRecWeights', 'PPPRecHandsWeights', 'PPPRecGridModel', 'PPPRecRestsModel']);
  weights.forEach(w => assert.ok(fs.existsSync(path.join(REPO, w[1])), w[1]));
  /* and the globals are the ones the modules read */
  const src = f => fs.readFileSync(path.join(REPO, f), 'utf8');
  assert.ok(/PPPRecGridModel/.test(src('rec/grid.js')) && /PPPRecRestsModel/.test(src('rec/rests.js')) && /PPPRecHandsWeights/.test(src('rec/hands.js')) && /PPPRecWeights/.test(src('rec/index.js')));
});

test('flags: S3 beats below GRID_UNSURE with two onsets or more flag their bar; one onset, or a sure beat, does not', () => {
  const built = {
    stats: { barStarts: [0, 2, 4, 6] },
    recReport: { beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5], metre: { key: '4/4' }, metrePosterior: { '4/4': 0.9, '2/4': 0.1 } },
    gridPlan: { plan: [
      { beat: 1, kind: '16', conf: 0.5, n: 3 },     /* bar 1: flagged */
      { beat: 2, kind: '16', conf: 0.5, n: 1 },     /* a single onset: nothing to be unsure of */
      { beat: 5, kind: '3', conf: 0.95, n: 3 },     /* sure */
      { beat: 9, kind: '3', conf: 0.89, n: 2 }      /* bar 3: flagged */
    ] }
  };
  const f = RA.flags({ built: built });
  assert.deepEqual(f.measures, [1, 3]);
  assert.deepEqual(f.why, { 1: ['grid'], 3: ['grid'] });
  assert.equal(f.piece, null);
  assert.equal(f.counts.grid, 2);
  /* the threshold is a named constant and can be set */
  assert.deepEqual(RA.flags({ built: built, thresholds: { GRID_UNSURE: 0.4 } }).measures, []);
  /* the printed measure number follows the Score (a pickup is bar 0) */
  assert.deepEqual(RA.flags({ built: built, score: { measures: [{ number: 0 }, { number: 1 }, { number: 2 }, { number: 3 }] } }).measures, [0, 2]);
});

test('flags: S4 notes below HAND_LOW, HAND_BAR_MIN of them in one bar; the metre is said of the piece, not of a bar', () => {
  const heard = { notes: [] };
  for (let i = 0; i < 12; i++) heard.notes.push({ on: i * 0.25, off: i * 0.25 + 0.2, midi: 60 + i, vel: 64 });   /* bar 1 (0-2 s): 8 notes; bar 2 starts at 2 s */
  for (let i = 0; i < 6; i++) heard.notes.push({ on: 2 + i * 0.25, off: 2 + i * 0.25 + 0.2, midi: 60 + i, vel: 64 });
  /* a stand-in for the stage: the first three notes of bar 1 and one note of bar 2 are unsure */
  const lib = { assign: notes => ({ staff: notes.map(() => 1), conf: notes.map((n, i) => (n.on < 0.75 || (n.on >= 2 && n.on < 2.25) ? 0.4 : 0.95)), report: {} }) };
  const built = { stats: { barStarts: [0, 2, 4] }, recReport: { beats: [0, 1], metre: { key: '4/4' }, metrePosterior: { '4/4': 0.42, '2/4': 0.3, '3/4': 0.2, '2/2': 0.08 } }, gridPlan: { plan: [] } };
  const f = RA.flags({ built: built, heard: heard, handsLib: lib });
  assert.deepEqual(f.measures, [1], 'bar 1 has three unsure notes, bar 2 has one');
  assert.deepEqual(f.why, { 1: ['hands'] });
  assert.deepEqual(f.detail[1].hands, { low: 3, notes: 8 });
  assert.equal(f.piece.metre, '4/4');
  assert.equal(f.piece.posterior, 0.42);
  assert.deepEqual(f.piece.alternatives, ['2/4', '3/4']);
  /* a sure metre says nothing; a stage that throws leaves the rest, with the error named */
  assert.equal(RA.flags({ built: Object.assign({}, built, { recReport: Object.assign({}, built.recReport, { metrePosterior: { '4/4': 0.9 } }) }) }).piece, null);
  const bad = RA.flags({ built: built, heard: heard, handsLib: { assign() { const e = new Error('x'); e.code = 'E-HANDS-NO-MODEL'; throw e; } } });
  assert.deepEqual(bad.measures, []);
  assert.equal(bad.handsError, 'E-HANDS-NO-MODEL');
});

test('flags on a real v2 conversion: bars exist, every flag has a reason, and the classic conversion has none to give', () => {
  const p = piece(24);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  assert.ok(r.recReport && r.gridPlan);
  const f = RA.flags({ built: r, heard: { notes: p.notes }, handsLib: REC.hands });
  f.measures.forEach(m => { assert.ok(m >= 1 && m <= r.stats.barStarts.length); assert.ok(f.why[m].length >= 1); });
  assert.equal(RA.flags({ built: AS.toMusicXml({ notes: p.notes }, app) }).measures.length, 0, 'no gridPlan, no recReport, nothing to flag');
});

test('heardFromGraph: the performance a kept graph carries is the heard notes again (and converting them gives the same graph)', () => {
  const p = piece(16);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  const h = RA.heardFromGraph(r.graph);
  assert.equal(h.notes.length, p.notes.length);
  const want = p.notes.slice().sort((a, b) => a.on - b.on || a.midi - b.midi);
  h.notes.forEach((n, i) => { assert.ok(Math.abs(n.on - want[i].on) < 1e-6 && Math.abs(n.off - want[i].off) < 1e-6 && n.midi === want[i].midi && n.vel === want[i].vel); });
  const again = AS.toMusicXml({ notes: h.notes, pedals: h.pedals }, v2);
  assert.equal(again.xml, r.xml);
  assert.equal(SG.serialize(again.graph), SG.serialize(r.graph));
  assert.equal(RA.heardFromGraph({ performances: [] }), null);
  assert.equal(RA.heardFromGraph(null), null);
  assert.equal(RA.heardFromGraph({ performances: [{ kind: 'render', notes: [{ on: 1, off: 2, midi: 60 }] }] }), null, 'only the source performance is what was heard');
});

test('timeMap: heard time to written position through the linked notes; one wrong link cannot run it backwards; bars when nothing is linked', () => {
  const p = piece(16);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  const m = RA.timeMap(r.graph);
  assert.equal(m.kind, 'links');
  for (let i = 1; i < m.us.length; i++) { assert.ok(m.us[i] > m.us[i - 1] && m.q[i] > m.q[i - 1]); }
  /* the heard bar starts (the graph's own bar anchors) map to the written bar starts: a bar is 4 quarters */
  /* (before the first linked note the map stays on that note: the lead-in has nothing to light) */
  const anchors = r.graph.performances[0].anchors.filter(a => a.kind === 'bar' && a.us >= m.us[0]);
  const T = require(path.join(REPO, 'scoregraph', 'time.js')), RT = require(path.join(REPO, 'scoregraph', 'rational.js'));
  const startQ = id => RT.toNumber(T.measureStart(r.graph, id)) * 4;     /* the written start of a measure, in quarters (the first bar may be a pickup) */
  assert.ok(anchors.length >= 12);
  anchors.slice(0, 14).forEach(a => assert.ok(Math.abs(RA.qAtSeconds(m, a.us / 1e6) - startQ(a.m)) < 0.4, a.m + ': ' + RA.qAtSeconds(m, a.us / 1e6) + ' vs ' + startQ(a.m)));
  /* a note linked to the wrong head (one bar late): the longest consistent run is kept */
  const g = JSON.parse(JSON.stringify(r.graph));
  const perf = g.performances[0];
  const linked = perf.notes.filter(n => n.link);
  const victim = linked[Math.floor(linked.length / 2)], other = linked[linked.length - 3];
  victim.link = other.link;
  const m2 = RA.timeMap(g);
  assert.equal(m2.kind, 'links');
  for (let i = 1; i < m2.us.length; i++) assert.ok(m2.us[i] > m2.us[i - 1] && m2.q[i] > m2.q[i - 1], 'still strictly increasing');
  assert.ok(m2.us.length >= m.us.length - 2);
  /* no links: the bar anchors */
  const g3 = JSON.parse(JSON.stringify(r.graph));
  g3.performances[0].notes.forEach(n => { delete n.link; });
  const m3 = RA.timeMap(g3);
  assert.equal(m3.kind, 'bars');
  const a5 = anchors[5];
  assert.ok(Math.abs(RA.qAtSeconds(m3, a5.us / 1e6) - startQ(a5.m)) < 0.05);
  /* before the first pair and after the last, the ends; between two, a line */
  assert.equal(RA.qAtSeconds(m, 0), m.q[0]);
  assert.equal(RA.qAtSeconds(m, 1e6), m.q[m.q.length - 1]);
  assert.equal(RA.qAtSeconds({ kind: 'none', us: [], q: [] }, 3), null);
  const mid = RA.qAtSeconds({ kind: 'links', us: [0, 2e6], q: [0, 4] }, 1);
  assert.equal(mid, 2);
  assert.equal(RA.timeMap({ performances: [] }).kind, 'none');
});

test('playPlan: the heard notes at their own times and velocities; a key held under the damper pedal sounds until the pedal lifts; nothing invented or lost', () => {
  const heard = {
    notes: [{ on: 1, off: 1.4, midi: 60, vel: 70 }, { on: 1.1, off: 1.2, midi: 64, vel: 40 }, { on: 3, off: 3.2, midi: 67, vel: 0 }, { on: 5, off: 5.5, midi: 72, vel: 130 }, { on: 6, off: 6, midi: 50, vel: 50 }, { on: 2, off: 2.2, midi: 200, vel: 50 }],
    pedals: [{ on: 0.5, off: 2.5 }]
  };
  const plan = RA.playPlan(heard);
  assert.deepEqual(plan.map(n => n.midi), [60, 64, 67, 72], 'the zero-length and out-of-range notes are not played');
  assert.deepEqual(plan.map(n => n.t), [1, 1.1, 3, 5]);
  assert.equal(plan[0].off, 2.5, 'released under the pedal: rings to its lift');
  assert.equal(plan[1].off, 2.5);
  assert.equal(plan[2].off, 3.2, 'no pedal there');
  assert.deepEqual(plan.map(n => n.vel), [70, 40, 1, 127], 'velocities as heard, kept in 1-127');
  assert.equal(RA.playPlan(heard, { pedal: false })[0].off, 1.4);
  assert.equal(RA.playPlan({ notes: [] }).length, 0);
  assert.equal(RA.playPlan(null).length, 0);
  /* from: a note that ended before it is not in the plan */
  assert.deepEqual(RA.playPlan(heard, { from: 4 }).map(n => n.midi), [72]);
});

test('the classic conversion is untouched: toMusicXml without recording gives no recReport, and the app\'s mark is only for a graph v2 wrote', () => {
  const p = piece(16);
  const a = AS.toMusicXml({ notes: p.notes }, app), b = AS.toMusicXml({ notes: p.notes }, v2);
  assert.equal(a.recReport, undefined);
  assert.ok(b.recReport);
  assert.equal(b.graph.provenance.sources[0].params.recording.pipeline, 'v2');
  assert.equal(a.graph.provenance.sources[0].params.recording, undefined);
});
