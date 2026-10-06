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

/* ---- float noise in the positions, and the sort key (the independent review of G10a-6, p3: two lines on two staves starting together, the Score's
   running sum 3.2500000000000004 where the graph has 3.25; sorted on the raw numbers the two sides listed them in two orders and agree() said "differ") */
const mini = ottavas => ({ title: 't', composer: '', tempo: 100, staves: 2,
  measures: [1, 2].map(n => ({ number: n, lenQ: 4, w: 1, time: { beats: 4, beatType: 4 }, key: null, clefs: null, clefChanges: null, bar: null })),
  notes: [], chords: [], pedals: [], marks: [], tempos: [], dynamics: [], wedges: [], ottavas: ottavas });
const line = (staff, b, over) => Object.assign({ m: 1, b: b, endM: 2, endB: 2, size: 8, dir: 1, semitones: 12, staff: staff, number: null }, over || {});
const clone = x => JSON.parse(JSON.stringify(x));
const agreeMini = (score, graph) => SG.legacy.agreeFrom(mini(clone(score)), mini(clone(graph)));

test('two lines that start together on two staves agree when the Score\'s running sum is one ulp off (3.2500000000000004 against 3.25)', () => {
  const graphSide = [line(1, 3.25), line(2, 3.25)];
  const noisy = [line(1, 3.2500000000000004), line(2, 3.25)];
  assert.notEqual(noisy[0].b, noisy[1].b, 'the two numbers are not the same double');
  [noisy, noisy.slice().reverse(), [line(1, 3.25), line(2, 3.2500000000000004)]].forEach((s, i) => {
    const a = agreeMini(s, graphSide);
    assert.ok(a.ok, 'case ' + i + ': ' + JSON.stringify(a.diffs[0]));
  });
  /* the end positions are read the same way */
  const endNoisy = [line(1, 0, { endB: 2.0000000000000004 }), line(2, 0, { endB: 2 })];
  assert.ok(agreeMini(endNoisy, [line(1, 0), line(2, 0)]).ok, 'endB');
  assert.ok(agreeMini(endNoisy.slice().reverse(), [line(1, 0), line(2, 0)]).ok, 'endB reversed');
});

test('the order of two lines that start together on both staves is not music (a sort that ignores the staff would keep the listed order)', () => {
  const a = line(1, 1), b = line(2, 1);
  assert.ok(agreeMini([a, b], [b, a]).ok, 'the Score lists staff 1 first, the graph staff 2 first');
  assert.ok(agreeMini([b, a], [a, b]).ok);
  assert.ok(agreeMini([a, b], [a, b]).ok);
  /* and the same with the lines of one staff after the other's (the file's order) over a longer list */
  const many = [line(1, 0.5), line(1, 2.5, { endM: 3, endB: 1 }), line(2, 0, { semitones: -12, dir: -1 }), line(2, 2.5, { endM: 3, endB: 1, semitones: -12, dir: -1 })];
  const byPosition = many.slice().sort((x, y) => x.m - y.m || x.b - y.b || x.staff - y.staff);
  assert.ok(agreeMini(many, byPosition).ok);
  assert.ok(agreeMini(byPosition, many.slice().reverse()).ok);
});

test('lines that differ only by staff, and every other real difference, still disagree (16 cases, in any listed order)', () => {
  const base = [line(1, 3.25), line(2, 3.25, { semitones: -12, dir: -1 })];
  const differs = {
    'a line missing': l => l.pop(),
    'an extra line': l => l.push(line(1, 0)),
    'the staff of the first line': l => { l[0].staff = 2; },
    'the staff of the second line': l => { l[1].staff = 1; },
    'a line with no staff (assumed) for a named one': l => { l[0].staff = null; },
    'the first line down an octave': l => { l[0].semitones = -12; l[0].dir = -1; },
    'two octaves (15ma)': l => { l[0].semitones = 24; l[0].size = 15; },
    'the direction only': l => { l[1].dir = 1; },
    'the size only': l => { l[0].size = 15; },
    'the start bar': l => { l[0].m = 2; l[0].endM = 2; l[0].b = 0; },
    'the start by half a beat': l => { l[0].b += 0.5; },
    'the start by a thousandth': l => { l[0].b += 0.001; },
    'the end bar': l => { l[1].endM = 3; },
    'the end by half a beat': l => { l[1].endB += 0.5; },
    'the end by a thousandth': l => { l[1].endB += 0.001; },
    'both lines on the same staff (they differed only by staff)': l => { l[1].staff = 1; l[1].semitones = 12; l[1].dir = 1; }
  };
  const names = Object.keys(differs);
  assert.equal(names.length, 16);
  names.forEach(what => {
    [false, true].forEach(reverse => {
      const s = clone(base);
      differs[what](s);
      if (reverse) s.reverse();
      const a = agreeMini(s, base);
      assert.equal(a.ok, false, what + (reverse ? ' (listed the other way)' : ''));
      assert.ok(a.diffs.some(d => d.field.indexOf('ottavas') === 0), what);
    });
  });
  /* two lines that differ only by staff: staff 1 and staff 2 against staff 1 and staff 1 */
  const same = [line(1, 1), line(2, 1)];
  assert.equal(agreeMini(same, [line(1, 1), line(1, 1)]).ok, false);
});
