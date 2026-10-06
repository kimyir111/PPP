/* The one-note arranger's refusal of a v2 transcription, and the page's one more try (G10a-4, the review of #161; docs/GOALS/G10_AUDIO_TO_SCORE.md section 25.4).
   arrangeSingleNoteWithHandsFallback(graph, plan, title) is the page's own function, read from the app file and run here with the page's names replaced by stubs
   (the same technique as tests/realize/app-single-extract.js): arrangeSingleNote, loadRecordingModules, window.PPPAudioScore, window.PPPRecApp (the real rec/app.js).
   What is pinned:
     - a refusal with exactly ALL_CANDIDATES_HAVE_HARD_VIOLATIONS of a graph the staged conversion wrote is tried once more, on the conversion of the same heard notes with the classic hands
       (toMusicXml {recording: 'v2', hands: 'legacy', closeGaps, exactBars}); the result says so (handsFallback)
     - G10a-5b: when that is refused for the same reason too, the classic conversion of the same heard notes (toMusicXml {closeGaps, exactBars}, no recording, no hands) is arranged, and the
       result says so (classicFallback); the third refusal is the first refusal
     - BOUNDED, never a loop: arrangeSingleNote runs at most three times and the conversion at most twice; a second or a third refusal for another code ends it (the first refusal is the answer)
     - no retry for a graph the classic conversion wrote (or an arrangement, or a rebuilt one: no v2 source), for any other code, for a graph that keeps no heard notes, when v2's files do not load,
       when the conversion does not come back v2 or throws; a success is returned as it is
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO } = require('./helpers.js');
const RA = require(path.join(REPO, 'rec', 'app.js'));

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
function fnSource(name, isAsync) {
  const marker = '\n' + (isAsync ? 'async function ' : 'function ') + name + '(';
  const i = html.indexOf(marker);
  assert.ok(i >= 0, 'the page has ' + name);
  if (html.slice(i + 1).split('\n', 1)[0].endsWith('}')) return html.slice(i + 1, html.indexOf('\n', i + 1) + 1);
  const end = html.indexOf('\n}\n', i);
  assert.ok(end > 0, name + ' has a clean end');
  return html.slice(i + 1, end + 2);
}
const constLine = name => { const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(html); assert.ok(m, name); return m[0] + '\n'; };
const SRC = constLine('SINGLE_HANDS_FALLBACK_CODE') + fnSource('graphFromV2Recording') + fnSource('writtenByV2') + fnSource('arrangeSingleNoteWithHandsFallback', true)
  + 'return { arrangeSingleNoteWithHandsFallback, graphFromV2Recording, SINGLE_HANDS_FALLBACK_CODE };';
const make = deps => new Function('arrangeSingleNote', 'loadRecordingModules', 'window', SRC)(deps.arrangeSingleNote, deps.loadRecordingModules || (() => Promise.resolve(true)), deps.window);

const CODE = 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS';
const v2Graph = () => ({ provenance: { sources: [{ kind: 'audio-score', params: { recording: { pipeline: 'v2' } } }] }, performances: [{ kind: 'source', notes: [
  { on: 1e6, off: 1.5e6, midi: 60, vel: 70 }, { on: 1.5e6, off: 2e6, midi: 64, vel: 70 }, { on: 2e6, off: 2.5e6, midi: 67, vel: 70 }, { on: 2.5e6, off: 3e6, midi: 72, vel: 70 }], pedals: [] }] });
const classicGraph = () => ({ provenance: { sources: [{ kind: 'audio-score', params: { beatSource: 'audio' } }] }, performances: v2Graph().performances });
const arrangementGraph = () => ({ provenance: { sources: [{ kind: 'generator', tool: 'ppp.g8a-realizer' }, { kind: 'repair', tool: 'ppp.recording-tuplets' }] }, performances: [] });

/* a harness: arrangeSingleNote answers from `answers` (one per call, the last one repeated), and everything it is asked is logged */
function harness(answers, opt) {
  opt = opt || {};
  const log = { arrange: [], convert: [], loads: 0 };
  const rebuilt = { recReport: { skeleton: true }, graph: { rebuilt: true } };
  const classicBuilt = { graph: { classic: true } };   /* what the classic conversion returns: no recReport */
  const window = {
    PPPRecApp: opt.noRecApp ? null : RA,
    /* convertResult is the answer to the v2 conversion (the first), classicResult to the classic one (the second) */
    PPPAudioScore: { toMusicXml: (input, o) => { log.convert.push({ input, o }); if (opt.convertThrows) throw new Error('boom');
      if (o && o.recording === 'v2') return opt.convertResult === undefined ? rebuilt : opt.convertResult;
      return opt.classicResult === undefined ? classicBuilt : opt.classicResult; } }
  };
  const arrangeSingleNote = async (g, plan) => { log.arrange.push({ g, plan }); return answers[Math.min(log.arrange.length - 1, answers.length - 1)]; };
  const loadRecordingModules = async () => { log.loads++; return opt.modulesLoad === undefined ? true : opt.modulesLoad; };
  const api = make({ arrangeSingleNote, loadRecordingModules, window });
  return Object.assign({ log, rebuilt, classicBuilt }, api);
}
const REFUSED = { ok: false, reason: CODE };
const ARRANGED = { ok: true, graph: { arranged: true }, levelNote: null, rescued: null, report: {} };
const plan = { level: 'intermediate' };

test('graphFromV2Recording: only a graph whose provenance names the v2 pipeline', () => {
  const { graphFromV2Recording } = harness([REFUSED]);
  assert.equal(graphFromV2Recording(v2Graph()), true);
  assert.equal(graphFromV2Recording(classicGraph()), false);
  assert.equal(graphFromV2Recording(arrangementGraph()), false);
  [null, undefined, {}, { provenance: {} }, { provenance: { sources: null } }, { provenance: { sources: [null, { kind: 'audio-score' }] } }].forEach(g => assert.equal(graphFromV2Recording(g), false));
});

test('a v2 graph refused for hard violations is tried once more: the same heard notes, v2 with the classic hands, closeGaps and exactBars; the result says so', async () => {
  const h = harness([REFUSED, ARRANGED]);
  const g = v2Graph();
  const r = await h.arrangeSingleNoteWithHandsFallback(g, plan, 'Title');
  assert.equal(r.ok, true);
  assert.equal(r.handsFallback, 'legacy');
  assert.equal(r.graph, ARRANGED.graph, 'the arranged graph is the retry\'s');
  assert.equal(h.log.arrange.length, 2, 'arrangeSingleNote ran exactly twice');
  assert.equal(h.log.arrange[0].g, g, 'the first on the graph it was given');
  assert.equal(h.log.arrange[1].g, h.rebuilt.graph, 'the second on the rebuilt graph');
  assert.equal(h.log.arrange[1].plan, plan, 'the same plan');
  assert.equal(h.log.convert.length, 1, 'one conversion');
  assert.deepEqual(h.log.convert[0].o, { title: 'Title', closeGaps: true, exactBars: true, recording: 'v2', hands: 'legacy' });
  assert.deepEqual(h.log.convert[0].input.notes.map(n => n.midi), [60, 64, 67, 72], 'the heard notes the kept graph carries');
  assert.equal(h.log.convert[0].input.notes[1].on, 1.5, 'in seconds');
  assert.equal(h.log.loads, 1);
});

test('the retries are bounded: both refused with the same code is the first refusal (same object), arrangeSingleNote ran three times and never a fourth, two conversions', async () => {
  const second = { ok: false, reason: CODE, message: 'again' };
  const third = { ok: false, reason: CODE, message: 'and again' };
  const h = harness([REFUSED, second, third]);
  const r = await h.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T');
  assert.equal(r, REFUSED, 'the refusal the person sees is the first one, unchanged');
  assert.equal(r.handsFallback, undefined);
  assert.equal(r.classicFallback, undefined);
  assert.equal(h.log.arrange.length, 3);
  assert.equal(h.log.convert.length, 2, 'the v2 conversion with the classic hands, then the classic one');
  /* a second refusal for another reason ends it at two runs: no classic conversion */
  const h2 = harness([REFUSED, { ok: false, reason: 'UNREACHABLE' }]);
  assert.equal(await h2.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T'), REFUSED);
  assert.equal(h2.log.arrange.length, 2);
  assert.equal(h2.log.convert.length, 1);
  /* so does a third refusal for another reason (three runs, still the first refusal) */
  const h3 = harness([REFUSED, second, { ok: false, reason: 'SINGLE_CRASH' }]);
  assert.equal(await h3.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T'), REFUSED);
  assert.equal(h3.log.arrange.length, 3);
});

test('G10a-5b: refused again with the classic hands, the CLASSIC conversion of the same heard notes is arranged; the result says so, with the classic conversion\'s own options', async () => {
  const h = harness([REFUSED, { ok: false, reason: CODE }, ARRANGED]);
  const g = v2Graph();
  const r = await h.arrangeSingleNoteWithHandsFallback(g, plan, 'Title');
  assert.equal(r.ok, true);
  assert.equal(r.classicFallback, true);
  assert.equal(r.handsFallback, undefined, 'only the second retry made it');
  assert.equal(r.graph, ARRANGED.graph);
  assert.equal(h.log.arrange.length, 3, 'arrangeSingleNote ran exactly three times');
  assert.equal(h.log.arrange[0].g, g);
  assert.equal(h.log.arrange[1].g, h.rebuilt.graph, 'the second on the v2 graph with the classic hands');
  assert.equal(h.log.arrange[2].g, h.classicBuilt.graph, 'the third on the classic conversion\'s graph');
  assert.equal(h.log.arrange[2].plan, plan, 'the same plan');
  assert.equal(h.log.convert.length, 2);
  assert.deepEqual(h.log.convert[1].o, { title: 'Title', closeGaps: true, exactBars: true }, 'the classic branch: no recording, no hands');
  assert.deepEqual(h.log.convert[1].input.notes.map(n => n.midi), [60, 64, 67, 72], 'the same heard notes');
  assert.equal(h.log.loads, 1, 'v2\'s files are asked for once');
});

test('the classic fallback is not tried when the first retry already arranged it, and not when the v2 retry cannot be made', async () => {
  const h = harness([REFUSED, ARRANGED]);
  const r = await h.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T');
  assert.equal(r.handsFallback, 'legacy');
  assert.equal(r.classicFallback, undefined);
  assert.equal(h.log.convert.length, 1, 'no classic conversion');
  /* the v2 conversion did not come back v2 (rec/ cannot read the performance): the refusal as it was, no classic conversion either */
  const h2 = harness([REFUSED, ARRANGED], { convertResult: { graph: { x: 1 } } });
  assert.equal(await h2.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T'), REFUSED);
  assert.equal(h2.log.convert.length, 1);
  /* the classic conversion gives nothing: the refusal */
  const h3 = harness([REFUSED, { ok: false, reason: CODE }, ARRANGED], { classicResult: null });
  assert.equal(await h3.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T'), REFUSED);
  assert.equal(h3.log.arrange.length, 2);
});

test('no retry for a graph the classic conversion wrote, an arrangement, or any graph without the v2 source', async () => {
  for (const g of [classicGraph(), arrangementGraph(), {}, { provenance: { sources: [] } }]) {
    const h = harness([REFUSED, ARRANGED]);
    const r = await h.arrangeSingleNoteWithHandsFallback(g, plan, 'T');
    assert.equal(r, REFUSED);
    assert.equal(h.log.arrange.length, 1, 'one arrangement attempt');
    assert.equal(h.log.convert.length, 0, 'no conversion');
    assert.equal(h.log.loads, 0, 'v2\'s files not even asked for');
  }
});

test('no retry for any other code: only ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', async () => {
  for (const reason of ['UNREACHABLE', 'NO_SELECTION', 'REPAIR_FAILED', 'SINGLE_CRASH', 'SINGLE_NOT_LOADED', 'REFERENCE_UNAVAILABLE', 'NO_GRAPH', 'all_candidates_have_hard_violations', 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS ', undefined]) {
    const refusal = { ok: false, reason };
    const h = harness([refusal, ARRANGED]);
    const r = await h.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T');
    assert.equal(r, refusal, String(reason));
    assert.equal(h.log.arrange.length, 1, String(reason));
    assert.equal(h.log.convert.length, 0, String(reason));
  }
});

test('a success is returned as it is, with no conversion and no handsFallback mark', async () => {
  const h = harness([ARRANGED]);
  const r = await h.arrangeSingleNoteWithHandsFallback(v2Graph(), plan, 'T');
  assert.equal(r, ARRANGED);
  assert.equal(r.handsFallback, undefined);
  assert.equal(h.log.arrange.length, 1);
  assert.equal(h.log.convert.length, 0);
});

test('the refusal stands when the retry cannot be made: no heard notes kept, v2 files not loaded, no rec/app, no v2 result, a throw', async () => {
  const noNotes = v2Graph(); noNotes.performances = [];
  const cases = [
    ['a graph that keeps no heard notes (rebuilt from the Score)', noNotes, {}],
    ['v2\'s files did not load', v2Graph(), { modulesLoad: false }],
    ['the conversion did not come back v2 (no recReport)', v2Graph(), { convertResult: { graph: { x: 1 } } }],
    ['the conversion returned nothing', v2Graph(), { convertResult: null }],
    ['the conversion has no graph', v2Graph(), { convertResult: { recReport: {} } }],
    ['the conversion threw', v2Graph(), { convertThrows: true }],
    ['rec/app is missing', v2Graph(), { noRecApp: true }]
  ];
  for (const [name, g, opt] of cases) {
    const h = harness([REFUSED, ARRANGED], opt);
    let r, threw = null;
    try { r = await h.arrangeSingleNoteWithHandsFallback(g, plan, 'T'); } catch (e) { threw = e; }
    assert.equal(threw, null, name + ': never throws');
    assert.equal(r, REFUSED, name);
    assert.equal(h.log.arrange.length, 1, name + ': nothing was arranged a second time');
  }
});

test('the page uses it where it arranges one note per hand, from a graph the page converted itself: the Song Arranger AND (G10a-5b) the review screen\'s Apply arrangement; the copies are marked', () => {
  const uses = html.match(/arrangeSingleNoteWithHandsFallback\(/g) || [];
  assert.equal(uses.length, 3, 'its definition, the Song Arranger and the review screen');
  assert.match(html, /sn = await arrangeSingleNoteWithHandsFallback\(src\.graph, plan, sourceScore\.title\)/, 'the Song Arranger');
  assert.match(html, /const sn = await arrangeSingleNoteWithHandsFallback\(built\.graph, plan, S\.score\.title\)/, 'the review screen: it was one arrangeSingleNote run, and p6 was refused there');
  assert.match(html, /sn\.handsFallback \? \{ handsFallback: sn\.handsFallback \} : \{\}, sn\.classicFallback \? \{ classicFallback: true \} : \{\}/, 'the Song Arranger copy\'s source.arrangement names the fallback');
  assert.match(html, /Object\.assign\(\{ engine: 'ppp\.g9-single' \}, sn\.handsFallback \? \{ handsFallback: sn\.handsFallback \} : \{\}, sn\.classicFallback \? \{ classicFallback: true \} : \{\}\)/, 'and so does the review screen\'s');
  assert.equal((html.match(/await arrangeSingleNote\(/g) || []).length, 2, 'arrangeSingleNote: the fallback\'s first run and its retry loop; nowhere else');
});
