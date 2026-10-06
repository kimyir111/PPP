/* legacy.agree and the order of the octave lines (G10a-6, docs/GOALS/G10_AUDIO_TO_SCORE.md section 29).
   The app reads a MusicXML recording into a Score (parseMusicXML), which lists the octave lines in the order the file says them: within a bar, one staff's stream after the other's.
   The graph the conversion made lists them by position. A recording with a line on each staff in one bar (the 8va of the right hand starting after the 8vb of the left) is the same
   music in two orders, and agree() said "ottavas differ", so the engraver gave up the recording's own graph (SOURCE_DISAGREE: a drawing from the Score, no rests/ties/tuplets of the graph).
   The order of the lines is not music (Score.finalize reads each note against the lines of ITS staff and takes the latest start): agree() now reads them as a set, like the dynamics.
   What still disagrees: a missing line, an extra one, another staff, another shift, another end. node --test tests/scoregraph */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const F = require(path.join(REPO, 'tests', 'recording-v2-fixtures.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const graph = AS.toMusicXml({ notes: F.crossLines(9).notes, title: 't' }, v2).graph;
const fresh = () => JSON.parse(JSON.stringify(SG.legacy.toScore(graph)));

test('the fixture has lines on both staves, one staff\'s start after the other\'s in a bar', () => {
  const o = fresh().ottavas;
  assert.ok(o.length >= 6);
  assert.ok(new Set(o.map(x => x.staff)).size === 2, 'both staves');
  assert.ok(o.some((x, i) => i > 0 && o[i - 1].m === x.m && o[i - 1].staff !== x.staff), 'two lines start in one bar');
});

test('the same lines in another order agree: the document order of the file, the reverse, a shuffle', () => {
  const orders = [l => l.slice().reverse(), l => l.slice().sort((a, b) => a.m - b.m || a.staff - b.staff || a.b - b.b), l => l.slice().sort((a, b) => b.staff - a.staff || a.m - b.m || a.b - b.b)];
  orders.forEach((order, i) => {
    const s = fresh();
    s.ottavas = order(s.ottavas);
    const a = SG.legacy.agree(s, graph);
    assert.ok(a.ok, 'order ' + i + ': ' + JSON.stringify(a.diffs[0]));
  });
  assert.ok(SG.legacy.agree(fresh(), graph).ok, 'and the graph\'s own order');
});

test('a missing line, an extra one, another staff, another shift and another end each still disagree', () => {
  const mutate = (what, edit) => {
    const s = fresh();
    edit(s.ottavas);
    s.ottavas.reverse();
    const a = SG.legacy.agree(s, graph);
    assert.equal(a.ok, false, what);
    assert.ok(a.diffs.some(d => d.field.indexOf('ottavas') === 0), what + ': ' + JSON.stringify(a.diffs[0]));
  };
  mutate('a missing line', l => l.pop());
  mutate('an extra line', l => l.push(Object.assign({}, l[0], { m: l[0].m + 1, endM: l[0].endM + 1 })));
  mutate('another staff', l => { l[2].staff = 3 - l[2].staff; });
  mutate('another shift', l => { l[1].semitones = -l[1].semitones; l[1].dir = -l[1].dir; });
  mutate('another end', l => { l[3].endB += 0.5; });
  mutate('another start', l => { l[4].b += 0.5; });
});
