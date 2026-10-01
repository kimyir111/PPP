/* "consecutive rests" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the teacher's score of a YouTube transcription showed two small dotted rests in a row before a quarter note
   (a dotted 16th rest and a 16th rest) and a dotted 16th rest inside a beamed 16th group. audio-score.js writes a silence one piece at a time, so one silence came out as two rests.
   scoregraph/gaps.js mergeRests writes ONE silence as one rest, or as the standard tiling on the beat grid:
     - a run = rests of one voice that follow each other with no event between them; its silence [a, b) on the 32nd grid is written again as the longest value that starts on a multiple of
       its own length and does not cross a beat line unless it starts on a beat (no dotted rest shorter than a dotted eighth; a 32nd left over at the end is a hole when a note follows)
     - a silence off the 32nd grid (a triplet position at one end, a straight one at the other) is ONE rest of the plain value, the rest of it a hole; a tuplet silence stays
     - never a note: every note keeps its onset, length, written value and pitch; a whole-bar rest is not touched; rests a spanner refers to are not touched
     - idempotent (the same graph object comes back), never a throw, a clean score is returned as it is
     - gated like closeSmallGaps: audio-score.js with opts.closeGaps (a recording), repair/index.js's transcription gate; the library default and a printed score are untouched */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const V = require(path.join(REPO, 'scoregraph/validate.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const A = require(path.join(REPO, 'audio-score.js'));

const TICKS = 96;
const ticks = s => { const r = R.parse(s); return r.n * TICKS / r.d; };
function notes(g) {
  const mi = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
  return g.parts[0].events.filter(e => e.kind === 'note').map(e => [mi.get(e.m), e.staff, e.at, e.dur, JSON.stringify(e.display), e.heads.map(h => h.pitch.step + h.pitch.oct).join('+')].join('|')).sort();
}
/* the rests of a voice in a measure as [startTick, lengthTicks, 'type' + dots (+ '!' for a measure rest)] in time order (voiceIdx counts the part's voices) */
function rests(g, bar, voiceIdx) {
  const mi = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
  const vo = g.parts[0].voices[voiceIdx || 0].id;
  return g.parts[0].events.filter(e => e.kind === 'rest' && mi.get(e.m) === bar && e.voice === vo)
    .map(e => [ticks(e.at), ticks(e.dur), e.display.type + (e.display.dots ? '.'.repeat(e.display.dots) : '') + (e.display.measureRest ? '!' : '')]).sort((a, b) => a[0] - b[0]);
}
const merged = g => GAPS.mergeRests(g);
/* a bar from [name, 32nd units] pairs ('r' is a rest; a rest of a plain value is written as that value, any other length exactly; a note's written value is its own business here) */
const CODE = { 1: '32', 2: '16', 3: '16.', 4: '8', 6: '8.', 8: 'q', 12: 'q.', 16: 'h', 24: 'h.', 32: 'w' };
const L = (...parts) => parts.map(([name, u]) => (name === 'r' && CODE[u] ? 'r:' + CODE[u] : name + ':q=' + R.format(R.make(u, 32)))).join(' ');

test('3/32 + 3/32 in a row is written as ONE dotted eighth rest (it ends on a beat); notes are untouched', () => {
  /* bar 1: C5 16th, two dotted 16th rests, D5 quarter, E5 half: the silence [2/32, 8/32) */
  const g = mk({ rh: 'C5:16 r:16. r:16. D5:q E5:h', lh: 'C3:w' });
  assert.deepEqual(rests(g, 1), [[6, 9, '16th.'], [15, 9, '16th.']]);
  const r = merged(g);
  assert.equal(r.changed, true);
  assert.deepEqual(rests(r.graph, 1), [[6, 18, 'eighth.']]);
  assert.deepEqual(r.stats, { runs: 1, restsBefore: 2, restsAfter: 1, skipped: 0 });
  assert.deepEqual(notes(r.graph), notes(g), 'not a note changes');
  assert.equal(V.validate(r.graph).issues.filter(i => /^E-/.test(i.code)).length, 0, 'the graph validates');
});

test('a dotted 16th rest between 16ths is a 16th rest (a 32nd left over is a hole when a note follows, kept at the end of the hand\'s last measure)', () => {
  const g = mk({ rh: L(['C5', 2], ['r', 3], ['C5', 1], ['D5', 8], ['E5', 16], ['F5', 2]), lh: 'C3:w' });
  const r = merged(g);
  assert.deepEqual(rests(r.graph, 1), [[6, 6, '16th']]);
  assert.deepEqual(notes(r.graph), notes(g), 'the sound is as before: no note changed');
  /* a 5/32 silence that starts at 27/32: a 32nd then an eighth. With a later bar that has a note the 32nd is a hole; in the hand's last bar it is kept */
  const two = mk({ rh: L(['C5', 8], ['D5', 8], ['E5', 11], ['r', 5]) + ' | ' + L(['C5', 32]), lh: 'C3:w | C3:w' });
  assert.deepEqual(rests(merged(two).graph, 1), [[84, 12, 'eighth']]);
  const last = mk({ rh: L(['C5', 32]) + ' | ' + L(['C5', 8], ['D5', 8], ['E5', 11], ['r', 5]), lh: 'C3:w | C3:w' });
  assert.deepEqual(rests(merged(last).graph, 2), [[81, 3, '32nd'], [84, 12, 'eighth']]);
});

test('a silence that starts off a beat is tiled on the beat grid: aligned starts, no beat line crossed by a rest that does not start on a beat', () => {
  /* [11, 16): a 32nd (a hole: a note follows) and an eighth at the half beat */
  const g = mk({ rh: L(['C5', 11], ['r', 3], ['r', 2], ['D5', 8], ['E5', 8]), lh: 'C3:w' });
  assert.deepEqual(rests(merged(g).graph, 1), [[36, 12, 'eighth']]);
  /* [10, 16): a dotted eighth that ends on the beat (a 16th note, then the rest that fills the beat) */
  const h = mk({ rh: L(['C5', 10], ['r', 3], ['r', 3], ['D5', 8], ['E5', 8]), lh: 'C3:w' });
  assert.deepEqual(rests(merged(h).graph, 1), [[30, 18, 'eighth.']]);
});

test('property: every silence [a, b) of a 4/4 bar, as one piece or as 32nd pieces, is written by the rule (tiling, alignment, beat lines, no small dotted rest, no overlap, no note moved)', () => {
  let checked = 0;
  for (let a = 0; a < 32; a++) {
    for (let b = a + 1; b <= 32; b++) {
      for (const pieces of ['one', 'thirty-seconds']) {
        const parts = [];
        if (a > 0) parts.push(['C5', a]);
        if (pieces === 'one') parts.push(['r', b - a]); else for (let i = 0; i < b - a; i++) parts.push(['r', 1]);
        if (b < 32) parts.push(['D5', 32 - b]);
        /* a silence to the barline has a note after it in the next bar */
        const g = mk({ rh: L(...parts) + (b === 32 ? ' | ' + L(['C5', 32]) : ''), lh: 'C3:w' + (b === 32 ? ' | C3:w' : '') });
        const r = merged(g);
        const out = rests(r.graph, 1);
        if (a === 0 && b === 32) { assert.deepEqual(out, pieces === 'one' ? [[0, 96, 'whole']] : [[0, 96, 'whole!']], 'a lone whole-bar rest is left as it is; 32 pieces of it are one measure rest'); checked++; continue; }
        /* the pieces tile [a, b) in 32nds, except a 32nd left over at either end: a hole (a note follows in this bar or a later one) */
        const what = ' [' + a + ',' + b + ') ' + pieces + ' ' + JSON.stringify(out);
        let pos = a * 3;
        out.forEach(([at, len, name]) => {
          const u = at / 3, l = len / 3;
          if (at !== pos) assert.ok(at - pos === 3 && pos === a * 3, 'only a 32nd at the start may be left:' + what);
          pos = at + len;
          const dotted = name.indexOf('.') > -1;
          if (dotted) assert.ok(l >= 6, 'no dotted rest shorter than a dotted eighth:' + what);
          if (!dotted && l < 32) assert.equal(u % l, 0, 'an undotted rest starts on a multiple of its own length:' + what);
          if (u % 8 !== 0) assert.ok(Math.floor(u / 8) === Math.floor((u + l - 1) / 8) || (dotted && (u + l) % 8 === 0), 'crosses a beat line without starting on a beat:' + what);
        });
        /* at most a 32nd is left at the end; a silence of two 32nds that starts off the 32nd grid of the beat (a 16th long, starting on an odd 32nd) is two 32nd pieces, both left out (as closeSmallGaps leaves them) */
        assert.ok((b * 3 - pos <= 3 || (!out.length && b - a === 2)) && b * 3 - pos >= 0, 'at most a 32nd is left at the end:' + what);
        assert.deepEqual(notes(r.graph), notes(g));
        assert.equal(merged(r.graph).graph, r.graph, 'idempotent:' + what);
        checked++;
      }
    }
  }
  assert.ok(checked > 900, 'checked ' + checked);
});

test('a silence between a triplet position and a straight one is ONE rest of the plain value (the user\'s bar 17: 3/32 + 1/24); a tuplet silence and a whole-bar rest stay', () => {
  /* beat 1 C5 quarter; beat 2: D5 triplet eighth (8 ticks), a dotted 16th rest (9), a 1/24 rest (4), E5 32nd (3): the silence [32, 45) is 13 ticks */
  const g = mk({ rh: 'C5:q D5:8=1/12 r:16. r:16=1/24 E5:32 F5:h', lh: 'C3:w' });
  assert.deepEqual(rests(g, 1), [[32, 9, '16th.'], [41, 4, '16th']]);
  const r = merged(g);
  assert.deepEqual(rests(r.graph, 1), [[32, 12, 'eighth']], 'an eighth rest from where the triplet note ended; the tick left over is a hole');
  assert.deepEqual(notes(r.graph), notes(g));
  assert.equal(merged(r.graph).graph, r.graph);
  /* a quarter rest and a triplet eighth rest (4/3 of a beat) are a tuplet silence: left as they are */
  const t = mk({ rh: 'C5:q r:q r:8=1/12 E5:h=5/12', lh: 'C3:w' });
  assert.equal(merged(t).changed, false);
  assert.equal(merged(t).graph, t);
  /* a dotted 16th rest followed by a triplet quarter rest (one silence from 5/32 to 5/12: a beat line inside, no single rest): the straight piece is written by the rule (a 16th), the triplet rest stays */
  const sp = mk({ rh: 'C5:q=5/32 r:16. r:q=1/6 E5:h=7/12', lh: 'C3:w' });
  const sm = merged(sp);
  assert.deepEqual(rests(sm.graph, 1), [[18, 6, '16th'], [24, 16, 'quarter']]);
  assert.equal(merged(sm.graph).graph, sm.graph, 'idempotent');
  /* a whole-bar rest is not touched; a bar of two half rests is one measure rest */
  const w = mk({ rh: 'r:w | r:h r:h | C5:w', lh: 'C3:w | C3:w | C3:w' });
  const wr = merged(w);
  assert.deepEqual(rests(wr.graph, 1), rests(w, 1), 'bar 1 untouched');
  assert.deepEqual(rests(wr.graph, 2), [[0, 96, 'whole!']]);
});

test('rests inside a written tuplet (a spanner refers to them) are not touched; another voice is merged on its own', () => {
  const g = mk({ rh: '3q[C5:8 r:8 r:8] D5:q E5:h', lh: 'C3:w' });
  assert.equal(merged(g).changed, false);
  /* two voices on one staff: each is a run of its own; rests of two voices never join */
  const v = mk({ rh: L(['C5', 16], ['r', 3], ['r', 3], ['D5', 6], ['E5', 4]), rh2: 'r:h r:q r:q', lh: 'C3:w' });
  const r = merged(v);
  assert.deepEqual(rests(r.graph, 1, 0), [[48, 18, 'eighth.']], 'voice 1: the two dotted 16th rests on beat 3');
  assert.deepEqual(rests(r.graph, 1, 2), [[0, 96, 'whole!']], 'voice 2 is silent all bar: one measure rest');
  assert.deepEqual(notes(r.graph), notes(v));
});

test('meters: 3/4 (a half rest only on beat 1) and 6/8 (a dotted quarter is the beat)', () => {
  /* 3/4: the silence of beats 2 and 3 written as one half rest (it starts on beat 2, not on a multiple of its own length) is two quarter rests */
  const g = mk({ time: [3, 4], rh: 'C5:q r:h', lh: 'C3:h.' });
  assert.deepEqual(rests(merged(g).graph, 1), [[24, 24, 'quarter'], [48, 24, 'quarter']]);
  const g2 = mk({ time: [3, 4], rh: 'r:q C5:q r:q', lh: 'C3:h.' });
  assert.equal(merged(g2).changed, false);
  /* 6/8: a 3/8 silence on the second beat is one dotted quarter rest (it is the beat) */
  const six = mk({ time: [6, 8], rh: 'C5:q. r:8 r:8 r:8', lh: 'C3:h.' });
  assert.deepEqual(rests(merged(six).graph, 1), [[36, 36, 'quarter.']]);
});

test('a graph with nothing to merge comes back as the same object; garbage never throws', () => {
  const clean = mk({ rh: 'C5:q r:q D5:q r:q | C5:h r:h', lh: 'C3:w | C3:w' });
  const c = merged(clean);
  assert.equal(c.changed, false);
  assert.equal(c.graph, clean);
  const bad = Object.freeze({ not: 'a graph' });
  const f = merged(bad);
  assert.equal(f.graph, bad);
  assert.equal(f.changed, false);
  assert.ok(f.stats.failed);
});

test('a recording\'s transcription: no run is left that is not in the standard tiling, notes unchanged, graph valid, idempotent; the library default and a MIDI source are untouched', () => {
  /* a seeded recording (as in g10r-transcription-rests.test.js): a run on the 32nd grid, each note held 25-85% of its gap, so silences come in several pieces */
  let s = 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const heard = [], pat = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 72, 71];
  for (let b = 0; b < 10; b++) {
    const t0 = b * 2;
    heard.push({ on: t0, off: t0 + 0.93, midi: 48, vel: 70 }, { on: t0 + 1, off: t0 + 1.93, midi: 43, vel: 70 });
    let t = 0, i = 0;
    while (t < 2 - 1e-9) {
      const x = rnd(), ioi32 = x < 0.45 ? 4 : x < 0.6 ? 3 : x < 0.7 ? 5 : x < 0.8 ? 2 : x < 0.9 ? 8 : 12, ioi = ioi32 * 0.0625;
      if (t + ioi > 2 + 1e-9) break;
      heard.push({ on: t0 + t + (rnd() - 0.5) * 0.01, off: t0 + t + ioi * (0.25 + 0.6 * rnd()), midi: pat[i % 16], vel: 80 });
      t += ioi; i++;
    }
  }
  const LOCK = { bpm: 120, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
  const build = o => A.toMusicXml({ notes: heard, pedals: [], title: 'synthetic' }, Object.assign({ title: 'synthetic', lock: LOCK }, o));
  const plain = build({}), closed = build({ closeGaps: true }), onlyGaps = GAPS.closeSmallGaps(plain.graph);
  assert.ok(GAPS.restRuns(onlyGaps.graph, { skipped: 0 }).length > 3, 'with only the gaps closed, runs are left that are not in the standard tiling');
  assert.equal(GAPS.restRuns(closed.graph, { skipped: 0 }).length, 0, 'none is left');
  assert.ok(closed.restReport && closed.restReport.runs > 3, JSON.stringify(closed.restReport));
  assert.deepEqual(notes(closed.graph), notes(onlyGaps.graph), 'the notes are those closeSmallGaps leaves: not a note changed by the merging');
  assert.equal(merged(closed.graph).graph, closed.graph, 'idempotent');
  assert.equal(GAPS.tidyRests(closed.graph).graph, closed.graph);
  assert.equal(V.validate(closed.graph).issues.filter(i => /^E-/.test(i.code)).length, 0);
  /* before: dotted 16th rests between notes; after: none (and no 32nd or 64th) */
  const small = g => g.parts[0].events.filter(e => e.kind === 'rest' && ((e.display.dots && e.display.type === '16th') || /^(32nd|64th)$/.test(e.display.type))).length;
  assert.ok(small(onlyGaps.graph) > 0, 'the control has them: ' + small(onlyGaps.graph));
  assert.equal(small(closed.graph), 0, 'no dotted 16th (or 32nd, 64th) rest remains');
  /* the library default (closeGaps unset) is exactly the plain build: no merge source in the graph */
  const def = A.toMusicXml({ notes: heard, pedals: [], title: 'synthetic' }, { title: 'synthetic', lock: LOCK });
  assert.equal(def.xml, plain.xml);
  assert.equal(JSON.stringify(def.graph), JSON.stringify(plain.graph));
  assert.ok(!def.graph.provenance.sources.some(x => x.tool === 'ppp.consecutive-rests'));
  assert.ok(closed.graph.provenance.sources.some(x => x.tool === 'ppp.consecutive-rests'));
  /* a MIDI file (sourceKind 'midi-file') is the player's own: never closed, never merged, even when asked */
  const midi = A.toMusicXml({ notes: heard, pedals: [], title: 'synthetic' }, { title: 'synthetic', lock: LOCK, closeGaps: true, sourceKind: 'midi-file' });
  assert.equal(midi.restReport, undefined);
  assert.ok(!midi.graph.provenance.sources.some(x => x.tool === 'ppp.consecutive-rests'));
});

test('the one-note pipeline gate: a printed score is not merged, a transcription is (report.mergedRests)', async () => {
  const CAND = require(path.join(REPO, 'candidates/index.js'));
  const SGG = require(path.join(REPO, 'songgraph/index.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  const g = await H.graphOf('tests/fixtures/g9f-small-gaps.musicxml');
  const asRecording = JSON.parse(JSON.stringify(g));
  asRecording.provenance.sources.forEach(x => { x.kind = 'audio-score'; });
  const request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
  const run = (graph, o) => {
    const sg = SGG.analyze(graph);
    let sel = CAND.run(graph, sg, request, { singleNoteHands: true });
    if (!sel.ok) sel = CAND.run(graph, sg, request, { singleNoteHands: true, relax: 2 });
    assert.ok(sel.ok);
    return REP.repairSelection(sel, graph, sg, request, o);
  };
  const printed = run(g, undefined);
  assert.equal(printed.report.mergedRests, undefined, 'a printed score: not run');
  assert.equal(printed.graph.provenance.sources.some(x => x.tool === 'ppp.consecutive-rests'), false);
  const auto = run(asRecording, undefined);
  assert.ok(auto.report.mergedRests, 'a transcription: run by default');
  assert.equal(GAPS.restRuns(auto.graph, { skipped: 0 }).length, 0, 'no run left that is not in the standard tiling');
  assert.equal(run(asRecording, { closeGaps: false }).report.mergedRests, undefined);
  assert.equal(REP.mergeRests, GAPS.mergeRests, 'one function');
});

test('the page\'s own scripts in a bare context run both passes; a page with an older gaps.js (no mergeRests) writes the score as before', () => {
  const tags = [...fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n').matchAll(/<script src="\.\/([^"?]+)(?:\?v=\d+)?"><\/script>/g)].map(m => m[1]);
  assert.ok(tags.includes('scoregraph/gaps.js'));
  const heard = [];
  for (let b = 0; b < 4; b++) for (let k = 0; k < 8; k++) heard.push({ on: b * 2 + k * 0.25, off: b * 2 + k * 0.25 + 0.16, midi: 60 + (k % 5), vel: 70 }, { on: b * 2 + k * 0.25, off: b * 2 + k * 0.25 + 0.2, midi: 40, vel: 70 });
  const opts = { title: 'page', closeGaps: true, lock: { bpm: 120, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 } };
  const load = gapsSource => {
    const ctx = vm.createContext({ console });
    ctx.window = ctx; ctx.globalThis = ctx;
    tags.filter(p => /^scoregraph\//.test(p) || p === 'audio-score.js').forEach(p => vm.runInContext(p === 'scoregraph/gaps.js' && gapsSource ? gapsSource : fs.readFileSync(path.join(REPO, p), 'utf8'), ctx, { filename: p }));
    return ctx;
  };
  const now = load(null).PPPAudioScore.toMusicXml({ notes: heard, pedals: [], title: 'page' }, opts);
  assert.ok(now.gapReport && now.restReport, 'both passes ran in the browser build');
  assert.equal(now.xml, A.toMusicXml({ notes: heard, pedals: [], title: 'page' }, opts).xml, 'the browser build writes the same file as Node');
  /* gaps.js as "Transcription rests at the source" shipped it: the closing is all there is */
  const full = fs.readFileSync(path.join(REPO, 'scoregraph/gaps.js'), 'utf8');
  const cut = full.replace('closeSmallGaps, mergeRests, tidyRests, tile, restRuns', 'closeSmallGaps');
  assert.notEqual(cut, full);
  const old = load(cut).PPPAudioScore.toMusicXml({ notes: heard, pedals: [], title: 'page' }, opts);
  assert.ok(old.gapReport, 'the gaps are closed as before');
  assert.equal(old.restReport, undefined, 'and nothing is merged');
});
