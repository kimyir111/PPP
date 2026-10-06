/* G10a-6: automatic 8va/8vb for the recording conversion v2 (audio-score.js, opts.ottava; docs/GOALS/G10_AUDIO_TO_SCORE.md section 29).
   realize/ottava.js (TD16) puts an octave line over runs of notes that need many ledger lines; here it runs on the graph a v2 RECORDING became, last, through scoregraph/pro.js
   professionalize, so the critic gives the input back unless nothing but the lines changed. What this pins, in Node (the page's side is tests/recording-v2-ottava.test.js):
     - a recording with notes far above and below the staff gets 8va / 8vb on the right staves, and the heads on 3 or more ledger lines fall from many to none
     - nothing else changes: the critic's fingerprint (sounding notes, onsets, staves, voices, spelling, marks, pedal, timeline) is equal but for the lines; the MusicXML is the
       lines-off file plus the <direction> of each line and nothing else; the stats are equal; the file read back has the same lines and the same sounding pitches
     - the lines are those of the FINAL graph (the hook is last, after G3's passes when opts.professional asks for them): the same graph as addOttava on the lines-off graph, ids included
     - idempotent: the pass on its own output finds the staffs marked and changes nothing; deterministic
     - opts.ottava: 'off' / false keep the graph without lines (the same file), 'on' / true / nothing are the default; the classic conversion has none whatever the option says
     - a piece with nothing out of range is the lines-off file; a critic that rejects the pass, a pass that throws and a page without realize/ottava.js each leave the input graph
     - mutants of audio-score.js (hook removed, applied to the wrong graph, applied to the classic conversion, option ignored, fallback ignored, critic bypassed) are each caught
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const F = require(path.join(REPO, 'tests', 'recording-v2-fixtures.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const PRO = require(path.join(REPO, 'scoregraph', 'pro.js'));
const O = require(path.join(REPO, 'scoregraph', 'ops.js'));
const CRIT = require(path.join(REPO, 'scoregraph', 'pro-critic.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));
const LS = require(path.join(REPO, 'scoregraph', 'tools', 'ledger-stats.js'));
const OTT = require(path.join(REPO, 'realize', 'ottava.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const app = { title: 't', closeGaps: true, exactBars: true };
const input = h => ({ notes: h.notes.map(n => Object.assign({}, n)), pedals: (h.pedals || []).map(p => Object.assign({}, p)), title: 't' });
const run = (h, extra, lib) => (lib || AS).toMusicXml(input(h), Object.assign({}, extra));
const lines = g => g.parts.reduce((a, p) => a.concat(p.spanners.filter(s => s.type === 'ottava')), []);
const OCTAVE_DIRECTION = /<direction\b[^>]*>(?:(?!<\/direction>)[\s\S])*?<octave-shift\b[\s\S]*?<\/direction>\s*/g;
const stripLines = xml => xml.replace(OCTAVE_DIRECTION, '');

const HIGH_LOW = F.highLow(12, 5), CROSS = F.crossLines(9), PLAIN = F.sextuplets(14, 7);

/* audio-score.js from its own source, with planted changes, and the modules it asks for answered by `req` (a map from './path' to a module) - the page's globals when `win` is given */
function load(mutations, req, win) {
  let src = fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8');
  (mutations || []).forEach(([from, to]) => {
    assert.equal(src.split(from).length - 1, 1, 'the mutation applies exactly once: ' + from.slice(0, 70));
    src = src.split(from).join(to);
  });
  const mod = { exports: {} };
  const r = id => (req && req[id]) || require(path.join(REPO, id));
  if (win) { new Function('window', src).call(null, win); return win.PPPAudioScore; }
  new Function('module', 'exports', 'require', src)(mod, mod.exports, r);
  return mod.exports;
}
/* the globals a page that loaded the modules has (rec/*.js, scoregraph's, and realize/ottava.js when `withOttava`) */
function pageWindow(withOttava) {
  const R = p => require(path.join(REPO, p));
  const win = { PPPScoreGraph: SG, PPPScoreGraphModules: { gaps: R('scoregraph/gaps.js'), recTuplet: R('scoregraph/rec-tuplet.js') }, PPPRec: R('rec/index.js'),
    PPPRecGrid: R('rec/grid.js'), PPPRecWriter: R('rec/writer.js'), PPPRecVoices: R('rec/voices.js'), PPPRecRests: R('rec/rests.js'), PPPRecKey: R('rec/key.js'), PPPRecPedal: R('rec/pedal.js') };
  if (withOttava) win.PPPRealizeModules = { ottava: OTT };
  return win;
}

test('a recording with notes far above and below the staff gets 8va and 8vb on the right staves', () => {
  const on = run(HIGH_LOW, v2), off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }));
  const sp = lines(on.graph);
  const staffNo = s => on.graph.parts[0].staves.findIndex(x => x.id === s.staff) + 1;
  assert.ok(sp.some(s => staffNo(s) === 1 && s.shift > 0), '8va (or 15ma) over the right hand: ' + JSON.stringify(sp.map(s => [staffNo(s), s.shift])));
  assert.ok(sp.some(s => staffNo(s) === 2 && s.shift < 0), '8vb (or 15mb) under the left hand');
  assert.ok(on.ottavaReport && on.ottavaReport.changed && !on.ottavaReport.fallback && on.ottavaReport.spans.length === sp.length);
  assert.equal(lines(off.graph).length, 0, 'the same call without lines is the earlier file');
  const withLines = LS.ledgerStats(on.graph), without = LS.ledgerStats(on.graph, { display: false });
  assert.ok(without.ge3 >= 40, 'heads on 3 or more ledger lines where the notes sound: ' + without.ge3);
  assert.equal(withLines.ge3, 0, 'and with the lines: ' + JSON.stringify(withLines.hist));
  assert.equal(withLines.heads, without.heads);
  assert.ok(withLines.shifted >= 40 && withLines.shifted <= withLines.heads);
});

test('the lines move only what is printed: the critic\'s fingerprint, the stats and the file are those of the lines-off conversion but for the lines', () => {
  [HIGH_LOW, CROSS].forEach(h => {
    const on = run(h, v2), off = run(h, Object.assign({}, v2, { ottava: 'off' }));
    assert.ok(lines(on.graph).length > 0);
    const fpOff = CRIT.fingerprint(off.graph), fpOn = CRIT.fingerprint(on.graph);
    assert.deepEqual(CRIT.check(fpOff, fpOn, ['ottava']), [], 'every component but ottava is equal');
    assert.ok(CRIT.check(fpOff, fpOn, []).length > 0, 'and ottava is what differs (the check can see it)');
    assert.deepEqual(CRIT.diff(fpOff, fpOn, CRIT.FIXED.concat(['sound'])), [], 'nothing the whole run may never change differs');
    assert.deepEqual(on.stats, off.stats);
    assert.equal(stripLines(on.xml), off.xml, 'the MusicXML is the lines-off file plus the directions of the lines');
    const n = (on.xml.match(/<octave-shift type="(?:up|down)"/g) || []).length;
    assert.equal(n, lines(on.graph).length);
    assert.equal((on.xml.match(/<octave-shift type="stop"/g) || []).length, n, 'every line is closed');
    assert.equal(on.xml.match(/<octave-shift type="up"/g) && on.xml.match(/<octave-shift type="up"/g).length > 0, h === HIGH_LOW || h === CROSS);
  });
});

test('read back, the file has the same lines and every note keeps the pitch it sounds', () => {
  const on = run(CROSS, v2);
  const back = SG.musicxml.import(on.xml, { scoreId: 'x' }).graph;
  const keyOf = g => lines(g).map(s => [g.parts[0].staves.findIndex(x => x.id === s.staff), s.shift].join(',')).sort();
  assert.deepEqual(keyOf(back), keyOf(on.graph));
  const pitches = g => g.parts[0].events.filter(e => e.kind === 'note').reduce((a, e) => a.concat(e.heads.map(h => h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct)), []).sort();
  assert.deepEqual(pitches(back), pitches(on.graph));
  const sounding = g => SG.legacy.toScore(g).notes.filter(n => !n.rest).map(n => n.midi).sort((a, b) => a - b);
  assert.deepEqual(sounding(back), sounding(on.graph));
});

test('the bars still add up and the graph is valid: notation-check classes 1-7 are 0, no error and no overlapping lines', () => {
  [HIGH_LOW, CROSS].forEach(h => {
    const on = run(h, v2);
    const rep = NC.checkGraph(on.graph);
    [1, 2, 3, 4, 5, 6, 7].forEach(c => assert.equal(rep.classes[c].count, 0, 'class ' + c));
    const V = SG.validate(on.graph).issues;
    assert.deepEqual(V.filter(i => i.severity === 'ERROR').map(i => i.code), []);
    assert.equal(V.filter(i => i.code === 'W-OTTAVA-OVERLAP').length, 0);
    assert.deepEqual(on.graphIssues.map(i => i.code).sort(), V.map(i => i.code).sort(), 'graphIssues are the validator\'s issues of the graph that is returned');
  });
});

test('the hook is last: the result is addOttava on the lines-off graph, ids included, and a second run changes nothing', () => {
  [HIGH_LOW, CROSS].forEach(h => {
    const on = run(h, v2), off = run(h, Object.assign({}, v2, { ottava: 'off' }));
    const again = OTT.addOttava(off.graph);
    assert.ok(again.changed && !again.fallback);
    assert.equal(SG.serialize(on.graph), SG.serialize(again.graph));
    const twice = OTT.addOttava(on.graph);
    assert.equal(twice.changed, false);
    assert.equal(twice.graph, on.graph, 'idempotent: the graph itself comes back');
    assert.deepEqual(twice.spans, []);
  });
});

test('deterministic: the same heard notes give the same lines and the same file', () => {
  const a = run(CROSS, v2), b = run(CROSS, v2);
  assert.equal(a.xml, b.xml);
  assert.deepEqual(a.ottavaReport.spans, b.ottavaReport.spans);
});

test('opts.ottava: \'off\' and false keep the graph without lines (the same file), \'on\', true and nothing are the default', () => {
  const dflt = run(HIGH_LOW, v2), off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' })), no = run(HIGH_LOW, Object.assign({}, v2, { ottava: false }));
  assert.ok(lines(dflt.graph).length > 0);
  assert.equal(lines(off.graph).length, 0);
  assert.equal(lines(no.graph).length, 0);
  assert.equal(off.xml, no.xml);
  assert.equal(off.ottavaReport, undefined, 'no pass, no report');
  assert.equal(no.ottavaReport, undefined);
  ['on', true].forEach(v => assert.equal(run(HIGH_LOW, Object.assign({}, v2, { ottava: v })).xml, dflt.xml, String(v)));
  /* only 'off' and false are off: any other value is the default */
  ['', 'ON', 0, null, {}].forEach(v => assert.equal(run(HIGH_LOW, Object.assign({}, v2, { ottava: v })).xml, dflt.xml, String(v)));
});

test('the classic conversion has no lines, whatever the option says (the same file as without it)', () => {
  const plain = run(HIGH_LOW, app);
  assert.equal(lines(plain.graph).length, 0);
  assert.equal(plain.ottavaReport, undefined);
  [true, 'on', false, 'off'].forEach(v => {
    const r = run(HIGH_LOW, Object.assign({}, app, { ottava: v }));
    assert.equal(r.xml, plain.xml, String(v));
    assert.equal(lines(r.graph).length, 0);
  });
  /* and the library's own default (no app options) */
  assert.equal(lines(run(HIGH_LOW, {}).graph).length, 0);
  assert.ok(LS.ledgerStats(plain.graph).ge3 > 0, 'the classic score is the one with the ledger lines');
  assert.equal(LS.ledgerStats(plain.graph).shifted, 0);
});

test('a v2 recording with nothing out of range is the lines-off file: the pass ran and found nothing', () => {
  const on = run(PLAIN, v2), off = run(PLAIN, Object.assign({}, v2, { ottava: 'off' }));
  assert.equal(on.xml, off.xml);
  assert.equal(lines(on.graph).length, 0);
  assert.deepEqual(on.ottavaReport, { changed: false, fallback: false, spans: [] });
  assert.equal(SG.serialize(on.graph), SG.serialize(off.graph));
});

/* ---- a pass the critic rejects, one that throws, and a page without the file */
test('a critic that rejects the pass gives the input graph back, and the page behaves as before', () => {
  const bad = {
    addOttava(g) {
      /* an 8va pass that also moves a pitch: the critic must see it (fingerprint component 'sound'/'pitch') */
      const pass = { name: 'ottava', may: ['ottava'], run(gg, ctx) {
        const res = O.edit(gg, d => { const e = d.doc.parts[0].events.find(x => x.kind === 'note'); e.heads[0].pitch = Object.assign({}, e.heads[0].pitch, { oct: e.heads[0].pitch.oct + 1 }); d.touch(); }, { validate: false, source: ctx.source });
        return { graph: res.graph, idMap: res.idMap, changes: [] };
      } };
      const r = PRO.professionalize(g, { mode: 'rewrite', passList: [pass] });
      return { graph: r.graph, changed: r.graph !== g, fallback: !!r.report.fallback, spans: [], report: r.report, issues: r.issues || null };
    }
  };
  const lib = load([], { './realize/ottava.js': bad });
  const off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }));
  const r = run(HIGH_LOW, v2, lib);
  assert.equal(r.xml, off.xml);
  assert.equal(SG.serialize(r.graph), SG.serialize(off.graph));
  assert.equal(r.ottavaReport.fallback, true);
  assert.equal(r.ottavaReport.changed, false);
});

test('a pass that throws leaves the graph as it was and never throws out of the conversion', () => {
  const lib = load([], { './realize/ottava.js': { addOttava() { throw new Error('boom'); } } });
  const off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }));
  const r = run(HIGH_LOW, v2, lib);
  assert.equal(r.xml, off.xml);
  assert.equal(r.ottavaReport.fallback, true);
  assert.match(r.ottavaReport.error, /boom/);
});

test('a page without realize/ottava.js writes the v2 score without lines; with it, the lines (the page\'s globals, no require)', () => {
  const withLib = load([], null, pageWindow(true)), without = load([], null, pageWindow(false));
  const a = run(HIGH_LOW, v2, withLib), b = run(HIGH_LOW, v2, without), off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }));
  assert.ok(lines(a.graph).length > 0, 'the page with the module has the lines');
  assert.equal(lines(b.graph).length, 0, 'the page without it has none');
  assert.equal(b.xml, off.xml);
  assert.deepEqual(b.ottavaReport, { changed: false, fallback: false, missing: true });
  assert.equal(a.xml, run(HIGH_LOW, v2).xml, 'and the page\'s lines are the Node lines');
});

/* ---- mutants of audio-score.js: each plants one defect in the hook; the suite must see it */
const HOOK_IF = 'if (ottavaWanted(opts, extra)) {';
const WANTED = "extra.recording === 'v2' && opts.ottava !== false && opts.ottava !== 'off'";
const KEEP = 'if (o.changed && !o.fallback) {';
/* the checks a conversion must pass, as one function of the library under test */
function checks(lib) {
  const on = run(HIGH_LOW, v2, lib), off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }), lib);
  assert.ok(lines(on.graph).length > 0, 'lines by default');
  assert.equal(lines(off.graph).length, 0, "'off' keeps none");
  assert.equal(lines(run(HIGH_LOW, Object.assign({}, v2, { ottava: false }), lib).graph).length, 0, 'false keeps none');
  assert.equal(lines(run(HIGH_LOW, app, lib).graph).length, 0, 'the classic conversion has none');
  const final = OTT.addOttava(run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }), lib).graph);
  assert.equal(SG.serialize(on.graph), SG.serialize(final.graph), 'the lines are those of the final graph');
  /* with G3's passes on (opts.professional) the graph the lines are put on is G3's, not the one the writer made */
  const pro = Object.assign({}, v2, { professional: 'on' });
  const proOn = run(CROSS, pro, lib), proFinal = OTT.addOttava(run(CROSS, Object.assign({}, pro, { ottava: 'off' }), lib).graph);
  assert.ok(lines(proOn.graph).length > 0 && proFinal.changed);
  assert.equal(SG.serialize(proOn.graph), SG.serialize(proFinal.graph), 'and with G3 passes on, the lines are those of the graph G3 made');
  const flagged = load(lib.__mutations || [], { './realize/ottava.js': { addOttava: g => Object.assign({}, OTT.addOttava(g), { fallback: true }) } });
  assert.equal(lines(run(HIGH_LOW, v2, flagged).graph).length, 0, 'a pass that reports a fallback is not used');
}
function mutant(mutations) { const lib = load(mutations); lib.__mutations = mutations; return lib; }
/* the mutant is built OUTSIDE the assertion: a mutation that does not apply is a failure of this suite, not a "caught" mutant */
function caught(name, mutations) {
  test('mutant: ' + name + ' is caught', () => {
    const lib = mutant(mutations);
    assert.throws(() => checks(lib), assert.AssertionError, 'the planted defect passes every check: ' + name);
  });
}
test('the checks pass on the real audio-score.js, and a mutation that does not apply is refused', () => {
  checks(AS);
  assert.throws(() => load([['this text is not in audio-score.js', 'x']]), /applies exactly once/);
});
caught('the hook removed', [[HOOK_IF, 'if (false) {']]);
caught('the option ignored (always on)', [[WANTED, "extra.recording === 'v2'"]]);
caught('applied to the classic conversion too', [[WANTED, "(extra.recording === 'v2' || true) && opts.ottava !== false && opts.ottava !== 'off'"]]);
caught('a fallback is used anyway', [[KEEP, 'if (o.changed) {']]);
caught('the hook reads the graph the writer made, not the final one (the rewrite of G3 is dropped)', [['const o = OT.addOttava(graph);', 'const o = OT.addOttava(built.graph);']]);
test('mutant: the critic bypassed (the pass is applied without professionalize\'s checks) is caught', () => {
  /* a library whose addOttava edits the graph with no critic: it would also move a pitch, which the lines-only comparison sees */
  const bypass = { addOttava(g) { const r = OTT.addOttava(g); const res = O.edit(r.graph, d => { const e = d.doc.parts[0].events.find(x => x.kind === 'note'); e.heads[0].pitch = Object.assign({}, e.heads[0].pitch, { oct: e.heads[0].pitch.oct + 1 }); d.touch(); }, { validate: false }); return Object.assign({}, r, { graph: res.graph }); } };
  const lib = load([], { './realize/ottava.js': bypass });
  const on = run(HIGH_LOW, v2, lib), off = run(HIGH_LOW, Object.assign({}, v2, { ottava: 'off' }));
  assert.ok(CRIT.check(CRIT.fingerprint(off.graph), CRIT.fingerprint(on.graph), ['ottava']).length > 0, 'the fingerprint sees a moved pitch');
  assert.notEqual(stripLines(on.xml), off.xml);
});
