/* The lead sheet in the app, the page's own functions (G10c-1b, docs/GOALS/G10_AUDIO_TO_SCORE.md section 34): read out of Piano Coach App.dc.html and run here with the page's names replaced by stubs
   (the technique of tests/rec/hands-fallback.test.js and tests/realize/app-single-extract.js), and then with the real arranger.

   What is pinned:
     - PPP.recordingArrange: 'leadsheet' | 'reduce', the default one constant (RECORDING_ARRANGE_DEFAULT) that says 'leadsheet', PPP.recording's layers (address, remembered choice, default), a value that is no choice
       puts the default back and forgets the remembered one
     - arrangeSingleNoteWithLeadsheet: a recording at a level other than 'original' in 'leadsheet' mode is arranged from its lead sheet first and by no other path (no retry of the hands); a refusal of any
       reason (LEADSHEET_*, UNREACHABLE, a hard violation, a crash, the module not loading) falls back to the reduction, with ITS chain; only when that refuses is the answer the reduction's refusal; the path
       that made the copy is in the result. 'reduce' (the page's mode or the plan's) and every request the lead sheet is not asked for (a catalogue piece, a MIDI file, 'original') are the reduction's
       own answer, the very object, with the very plan: nothing of the lead sheet is loaded
     - rec/leadsheet.js is in no up-front list and in neither RECORDING_SCRIPTS nor SINGLE_SCRIPTS (nothing new loads with the page, the Add screen or the review screen); the loader asks for it, after v2's files,
       and nowhere else; the two screens call arrangeSingleNoteWithLeadsheet and the reduction is called by it alone
     - the words for a relaxed lead-sheet copy are in every catalog, and the review tooling (review/lib/appcode.js arranger) takes the option
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO } = require('./helpers.js');
const RA = require(path.join(REPO, 'rec', 'app.js'));
const E = require(path.join(REPO, 'tests', 'realize', 'app-single-extract.js'));
const APP = require(path.join(REPO, 'review', 'lib', 'appcode.js'));
const SER = require(path.join(REPO, 'scoregraph', 'serialize.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const { cover, tune, convert, OPTS } = require('./leadsheet-fixtures.js');

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
const SRC = constLine('SINGLE_HANDS_FALLBACK_CODE') + fnSource('recordingArrangeChoice') + fnSource('leadsheetWanted') + fnSource('graphFromV2Recording') + fnSource('writtenByV2')
  + fnSource('arrangeSingleNoteWithHandsFallback', true) + fnSource('arrangeSingleNoteWithLeadsheet', true) + fnSource('leadsheetMark')
  + 'return { arrangeSingleNoteWithLeadsheet, arrangeSingleNoteWithHandsFallback, leadsheetWanted, leadsheetMark, recordingArrangeChoice };';
const make = deps => new Function('arrangeSingleNote', 'loadRecordingModules', 'loadLeadsheetModule', 'RECORDING_ARRANGE_MODE', 'window', SRC)(
  deps.arrangeSingleNote, deps.loadRecordingModules || (() => Promise.resolve(true)), deps.loadLeadsheetModule || (() => Promise.resolve(true)), deps.mode === undefined ? 'leadsheet' : deps.mode, deps.window || {});

const CODE = 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS';
const recGraph = () => ({ provenance: { sources: [{ kind: 'audio-score', params: { recording: { pipeline: 'v2' } } }] }, performances: [{ kind: 'source', notes: [
  { on: 1e6, off: 1.5e6, midi: 60, vel: 70 }, { on: 1.5e6, off: 2e6, midi: 64, vel: 70 }, { on: 2e6, off: 2.5e6, midi: 67, vel: 70 }, { on: 2.5e6, off: 3e6, midi: 72, vel: 70 }], pedals: [] }] });
const classicRecGraph = () => ({ provenance: { sources: [{ kind: 'audio-score', params: { beatSource: 'audio' } }] }, performances: recGraph().performances });
const printedGraph = () => ({ provenance: { sources: [{ kind: 'musicxml-import' }] } });
const midiGraph = () => ({ provenance: { sources: [{ kind: 'midi-file' }] } });
const ARRANGED = { ok: true, graph: { arranged: true }, levelNote: null, rescued: null, report: {} };
const LEADY = { ok: true, graph: { lead: true }, levelNote: 'relaxed-plan', rescued: null, report: {}, leadsheet: { version: '1.0.0', notes: 100, melodyNotes: 40, shifted: 3, instants: 50 } };
const REFUSED = { ok: false, reason: CODE };

/* a harness: arrangeSingleNote answers by what it is asked (plan.recordingArrange 'leadsheet' -> `lead`, anything else -> `reduce`, each an array of answers, the last repeated), and everything is logged */
function harness(answers, opt) {
  opt = opt || {};
  const log = { arrange: [], convert: [], loads: 0, leadLoads: 0 };
  const count = { lead: 0, reduce: 0 };
  const window = {
    PPPRecApp: RA,
    PPPAudioScore: { toMusicXml: (input, o) => { log.convert.push({ input, o }); return o && o.recording === 'v2' ? { recReport: {}, graph: { rebuilt: true } } : { graph: { classic: true } }; } }
  };
  const arrangeSingleNote = async (g, plan) => {
    log.arrange.push({ g, plan });
    const k = plan && plan.recordingArrange === 'leadsheet' ? 'lead' : 'reduce', list = answers[k] || [REFUSED];
    return list[Math.min(count[k]++, list.length - 1)];
  };
  const loadRecordingModules = async () => { log.loads++; return true; };
  const loadLeadsheetModule = async () => { log.leadLoads++; return opt.leadLoad === undefined ? true : opt.leadLoad; };
  return Object.assign({ log }, make({ arrangeSingleNote, loadRecordingModules, loadLeadsheetModule, mode: opt.mode, window }));
}

test('PPP.recordingArrange: the default is one constant and it says leadsheet; the choice, the address and the remembered value layer as PPP.recording\'s do', () => {
  const lines = html.match(/^const RECORDING_ARRANGE_DEFAULT = .*$/gm) || [];
  assert.deepEqual(lines, ["const RECORDING_ARRANGE_DEFAULT = 'leadsheet';"], 'one line, the whole flip');
  assert.equal((html.match(/RECORDING_ARRANGE_DEFAULT/g) || []).length >= 4, true);
  /* the mode's own code, run with a fake store and address */
  const a = html.indexOf('const RECORDING_ARRANGE_KEY'), b = html.indexOf('const _recLoaded');
  assert.ok(a > 0 && b > a);
  const body = html.slice(a, b) + 'return { get mode() { return RECORDING_ARRANGE_MODE; }, set: setRecordingArrangeMode, KEY: RECORDING_ARRANGE_KEY, DEFAULT: RECORDING_ARRANGE_DEFAULT, choice: recordingArrangeChoice };';
  const open = (stored, search, broken) => {
    const store = Object.assign({}, stored || {});
    const ls = broken ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const m = new Function('localStorage', 'location', 'URLSearchParams', body)(ls, { search: search || '' }, URLSearchParams);
    return { m, store };
  };
  const K = 'ppp.recordingArrange.v1';
  assert.equal(open().m.DEFAULT, 'leadsheet');
  assert.equal(open().m.mode, 'leadsheet', 'a fresh page');
  assert.equal(open({ [K]: 'reduce' }).m.mode, 'reduce', 'a remembered reduce');
  assert.equal(open({ [K]: 'leadsheet' }).m.mode, 'leadsheet');
  ['bogus', '', 'LEADSHEET', 'true', 'v2'].forEach(v => assert.equal(open({ [K]: v }).m.mode, 'leadsheet', 'a corrupt remembered value is ignored: ' + v));
  assert.equal(open({}, '?recordingArrange=reduce').m.mode, 'reduce', 'the address, this visit');
  assert.equal(open({ [K]: 'reduce' }, '?recordingArrange=leadsheet').m.mode, 'leadsheet', 'the address wins over the remembered choice');
  assert.equal(open({ [K]: 'reduce' }, '?recordingArrange=bogus').m.mode, 'reduce', 'an unknown address value has no say');
  assert.equal(open({ [K]: 'reduce' }, '?recordingArrange=').m.mode, 'reduce');
  const o = open({}, '?recordingArrange=reduce');
  assert.equal(K in o.store, false, 'the address is never stored');
  assert.equal(open(null, null, true).m.mode, 'leadsheet', 'no storage: the default');
  /* the setter */
  const s = open();
  assert.equal(s.m.set('reduce'), 'reduce'); assert.equal(s.store[K], 'reduce', 'a choice is remembered'); assert.equal(s.m.mode, 'reduce');
  assert.equal(s.m.set('leadsheet'), 'leadsheet'); assert.equal(s.store[K], 'leadsheet', 'and so is the other (PPP.recording writes the choice it makes)');
  assert.equal(s.m.set('reduce'), 'reduce');
  assert.equal(s.m.set('typo'), 'leadsheet', 'a value that is no choice: the default'); assert.equal(K in s.store, false, 'and the remembered choice is forgotten');
  assert.equal(s.m.set(null), 'leadsheet'); assert.equal(s.m.set(true), 'leadsheet'); assert.equal(s.m.set('Reduce'), 'leadsheet');
  assert.doesNotThrow(() => open(null, null, true).m.set('reduce'), 'an unwritable store does not throw');
  assert.equal(open(null, null, true).m.set('reduce'), 'reduce', 'and the choice holds for the tab');
});

test('a recording at a level other than original, in leadsheet mode, is arranged from its lead sheet: one run, the plan says so, no hands retry, nothing converted again; the result says which path made it', async () => {
  const h = harness({ lead: [LEADY], reduce: [ARRANGED] });
  const g = recGraph(), plan = { level: 'beginner' };
  const r = await h.arrangeSingleNoteWithLeadsheet(g, plan, 'T');
  assert.equal(r.ok, true);
  assert.equal(r.recordingArrange, 'leadsheet');
  assert.equal(r.graph, LEADY.graph);
  assert.equal(r.levelNote, 'relaxed-plan', 'the arranger\'s own note is carried');
  assert.equal(h.log.arrange.length, 1, 'one run');
  assert.equal(h.log.arrange[0].g, g);
  assert.equal(h.log.arrange[0].plan.recordingArrange, 'leadsheet');
  assert.equal(h.log.arrange[0].plan.level, 'beginner');
  assert.equal(plan.recordingArrange, undefined, 'the caller\'s plan is not touched');
  assert.equal(h.log.convert.length, 0, 'no conversion');
  assert.equal(h.log.loads, 0, 'v2\'s files are not asked for by the reduction\'s chain');
  assert.equal(h.log.leadLoads, 1, 'the lead sheet\'s module is asked for once');
  assert.equal(r.leadsheetRefusal, undefined);
  /* the same at each level but original */
  for (const level of ['intermediate', 'advanced']) {
    const h2 = harness({ lead: [LEADY], reduce: [ARRANGED] });
    assert.equal((await h2.arrangeSingleNoteWithLeadsheet(recGraph(), { level }, 'T')).recordingArrange, 'leadsheet', level);
  }
  /* a graph the classic conversion wrote is a recording too (an audio-score source) */
  const h3 = harness({ lead: [LEADY], reduce: [ARRANGED] });
  assert.equal((await h3.arrangeSingleNoteWithLeadsheet(classicRecGraph(), { level: 'beginner' }, 'T')).recordingArrange, 'leadsheet');
});

test('a lead sheet that refuses, whatever the reason, falls back to the reduction (with its own chain); the copy says it, and why', async () => {
  for (const reason of ['LEADSHEET_NO_MELODY', 'LEADSHEET_IRREGULAR_BARS', 'LEADSHEET_METRE', 'LEADSHEET_OFF_GRID', 'LEADSHEET_WRITE_FAILED', 'LEADSHEET_NOT_LOADED', 'UNREACHABLE', CODE, 'NO_SELECTION', 'REPAIR_FAILED', 'SINGLE_CRASH', 'SOMETHING_ELSE']) {
    const h = harness({ lead: [{ ok: false, reason }], reduce: [ARRANGED] });
    const r = await h.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'intermediate' }, 'T');
    assert.equal(r.ok, true, reason);
    assert.equal(r.recordingArrange, 'reduce', reason);
    assert.equal(r.leadsheetRefusal, reason, reason);
    assert.equal(r.graph, ARRANGED.graph, reason + ': the reduction\'s graph');
    assert.equal(h.log.arrange.length, 2, reason + ': the lead sheet, then the reduction');
    assert.equal(h.log.arrange[1].plan.recordingArrange, undefined, 'the reduction is asked with the plan it always got (no option)');
  }
  /* a refusal with no reason is named */
  const h0 = harness({ lead: [{ ok: false }], reduce: [ARRANGED] });
  assert.equal((await h0.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T')).leadsheetRefusal, 'unknown');
});

test('the reduction after a lead sheet refusal keeps its chain: the classic hands, then the classic conversion; the lead sheet itself is tried once, with no retry', async () => {
  const h = harness({ lead: [{ ok: false, reason: 'LEADSHEET_NO_MELODY' }], reduce: [REFUSED, ARRANGED] });
  const r = await h.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'Title');
  assert.equal(r.ok, true);
  assert.equal(r.handsFallback, 'legacy');
  assert.equal(r.recordingArrange, 'reduce');
  assert.equal(r.leadsheetRefusal, 'LEADSHEET_NO_MELODY');
  assert.equal(h.log.arrange.length, 3, 'lead, reduction, the reduction on the classic-hands graph');
  assert.deepEqual(h.log.arrange.map(a => a.plan.recordingArrange || null), ['leadsheet', null, null]);
  assert.equal(h.log.convert.length, 1);
  assert.deepEqual(h.log.convert[0].o, { title: 'Title', closeGaps: true, exactBars: true, recording: 'v2', hands: 'legacy' });
  /* a lead sheet refused for hard violations is NOT retried with the classic hands: the hands do not matter to a lead sheet */
  const h2 = harness({ lead: [REFUSED, ARRANGED], reduce: [ARRANGED] });
  const r2 = await h2.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r2.recordingArrange, 'reduce');
  assert.equal(h2.log.arrange.filter(a => a.plan.recordingArrange === 'leadsheet').length, 1, 'the lead sheet ran once');
  assert.equal(h2.log.convert.length, 0, 'and the lead sheet\'s refusal started no conversion');
  /* the whole chain refused (lead, reduction, v2 with the classic hands, the classic conversion): the reduction's refusal, the lead sheet's reason with it, and the run is bounded */
  const h3 = harness({ lead: [{ ok: false, reason: 'UNREACHABLE' }], reduce: [REFUSED] });
  const r3 = await h3.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, CODE, 'the refusal the person sees today');
  assert.equal(r3.leadsheetRefusal, 'UNREACHABLE');
  assert.equal(r3.recordingArrange, undefined);
  assert.equal(h3.log.arrange.length, 4, 'one lead sheet and the reduction\'s three, never more');
  assert.equal(h3.log.convert.length, 2);
});

test('the module that does not load, and a lead sheet that throws, are refusals: the reduction is made, nothing throws', async () => {
  const h = harness({ lead: [LEADY], reduce: [ARRANGED] }, { leadLoad: false });
  const r = await h.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r.ok, true); assert.equal(r.recordingArrange, 'reduce'); assert.equal(r.leadsheetRefusal, 'LEADSHEET_NOT_LOADED');
  assert.equal(h.log.arrange.filter(a => a.plan.recordingArrange === 'leadsheet').length, 0, 'the lead sheet was not even asked for');
  /* arrangeSingleNote that throws for the lead sheet */
  const calls = [];
  const g = make({ arrangeSingleNote: async (gr, plan) => { calls.push(plan.recordingArrange || null); if (plan.recordingArrange === 'leadsheet') throw new Error('boom'); return ARRANGED; } });
  const r2 = await g.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r2.ok, true); assert.equal(r2.leadsheetRefusal, 'LEADSHEET_CRASH'); assert.deepEqual(calls, ['leadsheet', null]);
  /* loadLeadsheetModule that throws */
  const g2 = make({ arrangeSingleNote: async () => ARRANGED, loadLeadsheetModule: async () => { throw new Error('boom'); } });
  const r3 = await g2.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r3.ok, true); assert.equal(r3.leadsheetRefusal, 'LEADSHEET_CRASH');
});

test('reduce, and every request the lead sheet is not asked for, is the reduction\'s own answer: the very object, the very plan, the lead sheet\'s module never asked for', async () => {
  const cases = [
    ['reduce mode', recGraph(), { level: 'beginner' }, { mode: 'reduce' }],
    ['the plan states reduce over a leadsheet page', recGraph(), { level: 'beginner', recordingArrange: 'reduce' }, {}],
    ['the original level', recGraph(), { level: 'original' }, {}],
    ['a printed score', printedGraph(), { level: 'beginner' }, {}],
    ['a MIDI file', midiGraph(), { level: 'beginner' }, {}],
    ['no provenance', {}, { level: 'beginner' }, {}],
    ['a malformed provenance', { provenance: { sources: { some: () => { throw new Error('x'); } } } }, { level: 'beginner' }, {}],
    ['no plan', recGraph(), null, {}]
  ];
  for (const [name, g, plan, opt] of cases) {
    const h = harness({ reduce: [ARRANGED] }, opt);
    const r = await h.arrangeSingleNoteWithLeadsheet(g, plan, 'T');
    assert.equal(r, ARRANGED, name + ': the reduction\'s own object');
    assert.equal(h.log.arrange.length, 1, name);
    assert.equal(h.log.arrange[0].plan, plan, name + ': the plan it was given, untouched');
    assert.equal(h.log.leadLoads, 0, name + ': nothing of the lead sheet is loaded');
    assert.equal(r.recordingArrange, undefined, name);
  }
  /* the plan's own statement beats the page's mode, both ways; and a leadsheet plan that is not a lead request goes to the reduction as a reduce plan */
  const h = harness({ lead: [LEADY], reduce: [ARRANGED] }, { mode: 'reduce' });
  assert.equal((await h.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner', recordingArrange: 'leadsheet' }, 'T')).recordingArrange, 'leadsheet');
  const h2 = harness({ lead: [LEADY], reduce: [ARRANGED] });
  await h2.arrangeSingleNoteWithLeadsheet(printedGraph(), { level: 'beginner', recordingArrange: 'leadsheet' }, 'T');
  assert.equal(h2.log.arrange.length, 1);
  assert.equal(h2.log.arrange[0].plan.recordingArrange, 'reduce', 'a printed score is not a lead sheet request: the reduction is asked as a reduction');
  /* the reduction's chain is the old one: a refusal for hard violations of a v2 recording in reduce mode is retried exactly as before */
  const h3 = harness({ reduce: [REFUSED, ARRANGED] }, { mode: 'reduce' });
  const r3 = await h3.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner' }, 'T');
  assert.equal(r3.handsFallback, 'legacy'); assert.equal(h3.log.arrange.length, 2); assert.equal(r3.recordingArrange, undefined, 'no mark in reduce mode: the copy is the page\'s of before');
});

test('a "Full song" import (an arrangement already) and any caller that says the song is no recording is the reduction\'s, whatever the mode: allow false; isLeadsheetSong says who the lead sheet is for', async () => {
  const h = harness({ lead: [LEADY], reduce: [ARRANGED] });
  const plan = { level: 'beginner' };
  const r = await h.arrangeSingleNoteWithLeadsheet(recGraph(), plan, 'T', false);
  assert.equal(r, ARRANGED, 'the reduction\'s own object');
  assert.equal(h.log.arrange.length, 1); assert.equal(h.log.arrange[0].plan, plan); assert.equal(h.log.leadLoads, 0);
  const h2 = harness({ lead: [LEADY], reduce: [ARRANGED] });
  const r2 = await h2.arrangeSingleNoteWithLeadsheet(recGraph(), { level: 'beginner', recordingArrange: 'leadsheet' }, 'T', false);
  assert.equal(r2, ARRANGED); assert.equal(h2.log.arrange[0].plan.recordingArrange, 'reduce', 'even a plan that asks for the lead sheet is a reduction when the caller says no');
  const h3 = harness({ lead: [LEADY], reduce: [ARRANGED] });
  assert.equal((await h3.arrangeSingleNoteWithLeadsheet(recGraph(), plan, 'T', true)).recordingArrange, 'leadsheet', 'allow true, and undefined (the tools), is the mode\'s decision');
  const SRC2 = fnSource('inferredAudioNotation') + fnSource('isRecordingSong') + fnSource('isLeadsheetSong') + 'return { isLeadsheetSong };';
  const { isLeadsheetSong } = new Function(SRC2)();
  assert.equal(isLeadsheetSong({ transcriptionVersion: 8, recordingPipeline: 'v2', kind: 'youtube' }), true, 'a v2 transcription');
  assert.equal(isLeadsheetSong({ transcriptionVersion: 7, kind: 'audio' }), true, 'a classic one');
  assert.equal(isLeadsheetSong({ transcriptionVersion: 7, taskMode: 'piano-arrangement' }), false, 'a Full song import');
  assert.equal(isLeadsheetSong({ transcriptionVersion: 7, kind: 'arrangement' }), false, 'a copy made by the arranger');
  assert.equal(isLeadsheetSong({ transcriptionVersion: 7, referenceScore: true }), false, 'a recording with its printed score');
  [null, undefined, {}, { kind: 'musicxml' }].forEach(s => assert.equal(isLeadsheetSong(s), false));
});

test('leadsheetMark: the copy\'s source says the path and, small, what the lead sheet did; nothing for a copy the lead sheet was not asked for', () => {
  const { leadsheetMark } = make({ arrangeSingleNote: async () => ARRANGED });
  assert.deepEqual(leadsheetMark({ recordingArrange: 'leadsheet', leadsheet: LEADY.leadsheet }), { recordingArrange: 'leadsheet', leadsheet: { version: '1.0.0', notes: 100, melodyNotes: 40, shifted: 3 } });
  assert.deepEqual(leadsheetMark({ recordingArrange: 'reduce', leadsheetRefusal: 'LEADSHEET_METRE' }), { recordingArrange: 'reduce', leadsheetRefusal: 'LEADSHEET_METRE' });
  assert.deepEqual(leadsheetMark({ ok: true }), {});
  assert.deepEqual(leadsheetMark(null), {});
  assert.deepEqual(leadsheetMark({ recordingArrange: 'leadsheet' }), { recordingArrange: 'leadsheet', leadsheet: {} });
});

test('the page: rec/leadsheet.js is in no up-front list, not in RECORDING_SCRIPTS or SINGLE_SCRIPTS; one loader asks for it after v2\'s files; the two screens call the one entry and it alone calls the reduction', () => {
  const L = E.scriptListOfPage();
  assert.equal(L.lead, 'rec/leadsheet.js');
  assert.equal(L.head.includes(L.lead), false, 'not a <script> of the page');
  assert.equal(L.rec.includes(L.lead), false, 'not one of v2\'s 13 files (the Add screen still asks for 17)');
  assert.equal(L.single.includes(L.lead), false, 'not one of the arranger\'s 14');
  assert.equal(L.rec.length, 13);
  assert.deepEqual(L.leadNeeds, ['rec/grid.js', 'rec/writer.js']);
  assert.ok(L.leadNeeds.every(f => L.rec.indexOf(f) >= 0) && L.rec.indexOf(L.leadNeeds[0]) < L.rec.indexOf(L.leadNeeds[1]), 'the files the lead sheet reads when it loads are two of v2\'s own, in v2\'s own order');
  assert.deepEqual(L.leadModel, ['PPPRecGridModel', 'rec/weights/ai5b-grid-v1.json']);
  const weights = html.match(/const RECORDING_WEIGHTS = \[[\s\S]*?\n\];/)[0];
  assert.ok(weights.indexOf("'PPPRecGridModel', 'rec/weights/ai5b-grid-v1.json'") > -1, 'the model is one of v2\'s four, the very file and global its loader sets');
  /* where the file name occurs as a string: its constant and its global's entry in the loader's table, nowhere else */
  assert.equal((html.match(/'rec\/leadsheet\.js'/g) || []).length, 2);
  assert.match(html, /^const LEADSHEET_SCRIPT = 'rec\/leadsheet\.js';$/m);
  assert.match(html, /'rec\/leadsheet\.js': \['PPPRecLeadsheet'\]/);
  /* the loader: v2's modules first, then the one file; the only asker of loadLeadsheetModule's promise besides the arranger entry and the warm */
  const loader = fnSource('loadLeadsheetModule');
  assert.ok(loader.indexOf('recFetchWeights(LEADSHEET_MODEL[1])') > -1 && loader.indexOf('recFetchWeights(LEADSHEET_MODEL[1])') < loader.indexOf('recScriptTag(s)'), 'the model first, then the scripts');
  assert.ok(loader.indexOf('LEADSHEET_NEEDS.concat([LEADSHEET_SCRIPT])') > -1 && loader.indexOf('!_recLoaded.has(s)') > -1, 'the two files it reads, then itself, and only what is not on the page already (nothing that loaded runs twice)');
  assert.equal(loader.indexOf('loadRecordingModules'), -1, 'it does not ask for the conversion\'s seventeen files');
  assert.ok(loader.indexOf('await _recPromise') > -1 && html.indexOf('if (_leadPromise) await _leadPromise;') > -1, 'neither loader runs while the other is on its way');
  const wantsWeightsShape = html.indexOf('recWeightsShapeOk(LEADSHEET_MODEL[0], j)');
  assert.ok(wantsWeightsShape > -1, 'the model is checked for its shape like v2\'s own');
  const askers = (html.match(/loadLeadsheetModule\(\)/g) || []).length;
  assert.equal(askers, 3, 'the loader itself, the entry (arrangeSingleNoteWithLeadsheet) and warmLeadsheetModule: ' + askers);
  assert.match(html, /warmLeadsheetModule\(\) \{\s*\n\s*if \(RECORDING_ARRANGE_MODE === 'leadsheet' && ARRANGER_MODE === 'single'\) loadLeadsheetModule\(\);/, 'the warm is a no-op unless a lead sheet would be made');
  /* every arrangeSingleNote call of the page is inside the two entry functions: arrangeSingleNoteWithHandsFallback's first run and its retry, the lead sheet's one run */
  assert.equal((html.match(/await arrangeSingleNote\(/g) || []).length, 3);
  assert.equal((html.match(/await arrangeSingleNoteWithHandsFallback\(/g) || []).length, 1, 'awaited once: the reduction after a lead sheet refusal (the other return is the request the lead sheet is not asked for)');
  assert.equal((html.match(/arrangeSingleNoteWithHandsFallback\(/g) || []).length, 3, 'its definition and the two returns of arrangeSingleNoteWithLeadsheet');
  assert.match(html, /sn = await arrangeSingleNoteWithLeadsheet\(src\.graph, plan, sourceScore\.title, !!d\.recording\)/, 'the Song Arranger (a recording that is no Full song: d.recording, set when it opens)');
  assert.match(html, /const sn = await arrangeSingleNoteWithLeadsheet\(built\.graph, plan, S\.score\.title, isLeadsheetSong\(S\.importSource\)\)/, 'the review screen\'s Apply arrangement');
  assert.equal((html.match(/arrangeSingleNoteWithLeadsheet\(/g) || []).length, 3, 'its definition and the two screens');
  /* the copies carry the mark and the words */
  assert.equal((html.match(/leadsheetMark\(sn\)\) \};/g) || []).length, 2, 'both copies\' source.arrangement');
  assert.match(html, /leadCopy \? tx\('PPP one-note-per-hand arrangement \(lead sheet\)'\)/, 'the Song Arranger\'s composer line');
});

test('the words: every string of the lead-sheet chip and the relaxed note is in the Korean, Japanese and Chinese catalogs, and the relaxed note names the key signature and the melody, not the left hand', () => {
  const strings = ['Arrange from a lead sheet', 'PPP one-note-per-hand arrangement (lead sheet)'];
  [/tx\('(On \(the default\): a recording is arranged from its melody and chords\.[^']*(?:\\'[^']*)*)'\)/, /tx\('(Off: a recording\\'s own notes are thinned out[^']*(?:\\'[^']*)*)'\)/, /tx\('(This arrangement keeps the recording\\'s own key signature[^']*(?:\\'[^']*)*)'\)/]
    .forEach(re => { const m = re.exec(html); assert.ok(m, String(re)); strings.push(m[1].replace(/\\'/g, '\'')); });
  assert.equal(strings.length, 5);
  for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) {
    const cat = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', loc + '.json'), 'utf8')).content;
    strings.forEach(s => { assert.ok(typeof cat[s] === 'string' && cat[s].length > 3, loc + ' lacks: ' + s.slice(0, 60)); assert.notEqual(cat[s], s, loc + ' is not translated: ' + s.slice(0, 60)); });
  }
  const ko = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
  const note = ko[strings[4]];
  assert.match(note, /조표/, 'the Korean note names the key signature');
  assert.match(note, /멜로디/, 'and the melody');
  assert.match(note, /왼손이 아니라/, 'and says it is not the left hand');
  assert.match(ko[strings[1]], /리드 시트/);
  assert.equal(strings[4].includes('many notes'), false);
});

test('the review tooling: arranger().arrange takes the option; without it the copy is the reduction as before; with it the copy is the lead sheet and says so', async () => {
  const g = convert(cover(16, tune));
  const ref = E.reference();
  const a = APP.arranger({ reference: ref });
  const plain = await a.arrange(JSON.parse(JSON.stringify(g)), 'beginner', 'T');
  const red = await a.arrange(JSON.parse(JSON.stringify(g)), 'beginner', 'T', { recordingArrange: 'reduce' });
  const lead = await a.arrange(JSON.parse(JSON.stringify(g)), 'beginner', 'T', { recordingArrange: 'leadsheet' });
  assert.equal(plain.ok, true); assert.equal(red.ok, true); assert.equal(lead.ok, true, lead.reason);
  assert.equal(SER.fingerprint(red.graph), SER.fingerprint(plain.graph), 'reduce is what no option gives');
  assert.equal(plain.recordingArrange, undefined, 'no option: no path to report (the tool\'s old result)');
  assert.equal(lead.recordingArrange, 'leadsheet');
  assert.ok(lead.leadsheet && lead.leadsheet.melodyNotes > 10, 'the lead sheet\'s report is carried');
  assert.notEqual(SER.fingerprint(lead.graph), SER.fingerprint(plain.graph), 'the lead sheet copy is another copy');
  /* the reduction arranger of the page is what an un-optioned request gets: the same graph the unwrapped arrangeSingleNote makes */
  const direct = await a.app.arrangeSingleNote(JSON.parse(JSON.stringify(g)), { level: 'beginner' });
  assert.equal(SER.fingerprint(plain.graph), SER.fingerprint(direct.graph));
  /* a lead sheet that refuses is the reduction's answer with the lead sheet's reason, in the tool as in the page (this graph has a short first bar: the reduction refuses it too) */
  const irregular = JSON.parse(JSON.stringify(g));
  irregular.timeline.measures[0].dur = '3/4';
  const fb = await a.arrange(irregular, 'beginner', 'T', { recordingArrange: 'leadsheet' });
  assert.equal(fb.leadsheetRefusal, 'LEADSHEET_IRREGULAR_BARS');
});

test('the page\'s own glue with the real arranger: a recording is a lead-sheet copy in leadsheet mode and, in reduce mode, the very copy arrangeSingleNote makes; a hymn is the same in both modes', async () => {
  const ref = E.reference();
  const app = E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(ref) });
  const win = { PPPRecApp: RA, PPPAudioScore: require(path.join(REPO, 'audio-score.js')) };
  const wrapFor = mode => new Function('arrangeSingleNote', 'loadRecordingModules', 'loadLeadsheetModule', 'RECORDING_ARRANGE_MODE', 'window', SRC)(app.arrangeSingleNote, () => Promise.resolve(true), () => Promise.resolve(true), mode, win);
  const g = convert(cover(16, tune));
  const lead = wrapFor('leadsheet'), red = wrapFor('reduce');
  for (const level of ['beginner', 'advanced']) {
    const l = await lead.arrangeSingleNoteWithLeadsheet(JSON.parse(JSON.stringify(g)), { level }, 'T');
    const r = await red.arrangeSingleNoteWithLeadsheet(JSON.parse(JSON.stringify(g)), { level }, 'T');
    const d = await app.arrangeSingleNote(JSON.parse(JSON.stringify(g)), { level });
    assert.equal(l.ok, true, level); assert.equal(l.recordingArrange, 'leadsheet', level);
    assert.equal(r.ok, true, level); assert.equal(SER.fingerprint(r.graph), SER.fingerprint(d.graph), level + ': reduce is arrangeSingleNote\'s own copy');
    assert.notEqual(SER.fingerprint(l.graph), SER.fingerprint(r.graph), level + ': the two ways make two copies');
  }
  const hymn = SG.musicxml.import(fs.readFileSync(path.join(REPO, 'catalog', 'hymns', 'silent-night.musicxml'), 'utf8'), { scoreId: 'h' });
  const hg = hymn.graph || hymn;
  const a = await lead.arrangeSingleNoteWithLeadsheet(JSON.parse(JSON.stringify(hg)), { level: 'beginner' }, 'T');
  const b = await red.arrangeSingleNoteWithLeadsheet(JSON.parse(JSON.stringify(hg)), { level: 'beginner' }, 'T');
  assert.equal(a.ok, true); assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph), 'a hymn is arranged the same in both modes');
  assert.equal(a.recordingArrange, undefined);
  /* a lead sheet that cannot be had (the module is not on the page): the reduction's copy, the very one arrangeSingleNote makes, marked as the reduction's */
  const noLead = E.nodeWindow(); delete noLead.PPPRecLeadsheet;
  const app2 = E.make({ window: noLead, Score: {}, loadArrangerReference: () => Promise.resolve(ref) });
  const w2 = new Function('arrangeSingleNote', 'loadRecordingModules', 'loadLeadsheetModule', 'RECORDING_ARRANGE_MODE', 'window', SRC)(app2.arrangeSingleNote, () => Promise.resolve(true), () => Promise.resolve(true), 'leadsheet', win);
  const f = await w2.arrangeSingleNoteWithLeadsheet(JSON.parse(JSON.stringify(g)), { level: 'beginner' }, 'T');
  const d2 = await app.arrangeSingleNote(JSON.parse(JSON.stringify(g)), { level: 'beginner' });
  assert.equal(f.ok, true); assert.equal(f.recordingArrange, 'reduce'); assert.equal(f.leadsheetRefusal, 'LEADSHEET_NOT_LOADED');
  assert.equal(SER.fingerprint(f.graph), SER.fingerprint(d2.graph), 'the fallback is the reduction, byte for byte');
});
