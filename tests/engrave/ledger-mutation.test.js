/* G4a: the ledger audit is not dead (docs/GOALS/G04 §23 in miniature, fixer P1).

   Each mutation edits the plan's SOURCE - a copy of engrave/ in a temporary directory, one anchored edit - the way a
   real regression would, then plans a probe graph with the mutated code and audits it. A mutation must
     1. find its anchor exactly once (CRLF normalised: a Windows checkout must not turn it into a no-op),
     2. change the plan's output for the probe (else it is dead and proves nothing), and
     3. make the audit fail under the category it names.
   The no-op control edits a comment: the output must be byte-identical and the audit clean. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SG, graphOf, goldenGraphs } = require('./helpers.js');

const MUTATIONS = [
  { id: 'L-TIE-OUTPUT', file: 'plan.js', probe: 'G16', expect: 'missing', what: 'a tie dropped from the output, its ledger entry kept',
    from: 'ties.push({ id: s.id, from: s.from || null, to: s.to || null, inferred: inferred });', to: '/* dropped */' },
  { id: 'L-ART-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'articulations dropped from the output',
    from: 'arts: (e.arts || []).slice(), orn: orn,', to: 'arts: [], orn: orn,' },
  { id: 'L-ART-LEDGER', file: 'plan.js', probe: 'burg015', expect: 'silent', what: 'an articulation carried with no disposition',
    from: "(e.arts || []).forEach((a, i) => sub(L.ref.art(e.id, i), 'articulation'));", to: '/* no ledger */' },
  { id: 'L-SLUR-GONE', file: 'plan.js', probe: 'burg015', expect: 'silent', what: 'slurs dropped from output and ledger alike',
    from: "if (s.type === 'beam' || s.type === 'tuplet') return;", to: "if (s.type === 'beam' || s.type === 'tuplet' || s.type === 'slur') return;" },
  { id: 'L-DERIVED-BEAM', file: 'plan-beams.js', probe: 'G16', expect: 'missing', what: 'a derived beam ledgered but not in the output',
    from: "out.push({ id: id, events: x.events.slice(), breaks: (x.breaks || []).map(y => ({ after: y.after, level: y.level })), source: 'derived',",
    to: "if (false) out.push({ id: id, events: x.events.slice(), breaks: (x.breaks || []).map(y => ({ after: y.after, level: y.level })), source: 'derived'," },
  { id: 'L-TIE-ENDS', file: 'plan.js', probe: 'G16', expect: 'altered', what: 'ties carried with their ends swapped',
    from: 'ties.push({ id: s.id, from: s.from || null, to: s.to || null, inferred: inferred });',
    to: 'ties.push({ id: s.id, from: s.to || null, to: s.from || null, inferred: inferred });' },
  { id: 'L-HEAD-PITCH', file: 'plan.js', probe: 'piano-marks', expect: 'altered', what: 'heads carried an octave off',
    from: 'return { id: h.id, staff: staffId, pitch: cp(h.pitch),',
    to: 'return { id: h.id, staff: staffId, pitch: h.pitch ? Object.assign(cp(h.pitch), { oct: h.pitch.oct + 1 }) : null,' },
  { id: 'L-UNAPPROVED', file: 'plan.js', probe: 'sonatina/002', expect: 'unapproved', what: 'a grace note deferred under a code G04 A1 does not allow',
    from: "after ? ['deferred', 'grace-after'] : ['drawn'];\n        const inherit", to: "after ? ['deferred', 'grace-late'] : ['drawn'];\n        const inherit" },
  { id: 'L-PEDAL-CHANGE', file: 'plan.js', probe: 'piano-marks', expect: 'missing', what: 'pedal changes dropped from the output',
    from: 'changes: cp(s.changes) || [],', to: 'changes: [],' },
  /* the final review's surviving output drops (G04 §32.13): each must now be caught under the category it names */
  { id: 'L-SLUR-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'slurs dropped from the output, their ledger entries kept',
    from: 'slurs.push({ id: s.id, from: s.from || null, to: s.to || null, placement: s.placement || null,',
    to: 'if (0) slurs.push({ id: s.id, from: s.from || null, to: s.to || null, placement: s.placement || null,' },
  { id: 'L-SLUR-ENDS', file: 'plan.js', probe: 'burg015', expect: 'altered', what: 'slurs carried with their ends swapped',
    from: 'slurs.push({ id: s.id, from: s.from || null, to: s.to || null,', to: 'slurs.push({ id: s.id, from: s.to || null, to: s.from || null,' },
  { id: 'L-FINGERING-OUTPUT', file: 'plan.js', probe: 'piano-marks', expect: 'missing', what: 'printed fingering dropped from the output',
    from: 'fingering: cfg.fingering && h.fingering ? cp(h.fingering) : [],', to: 'fingering: [],' },
  { id: 'L-ACC-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'accidentals dropped from the output',
    from: 'acc: cp(h.acc), notehead: cp(h.notehead),', to: 'acc: null, notehead: cp(h.notehead),' },
  { id: 'L-CLEF-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'clefs dropped from the output',
    from: 'clefs.push({ id: c.id, staff: c.staff,', to: 'if (0) clefs.push({ id: c.id, staff: c.staff,' },
  { id: 'L-HIDDEN-FLAG', file: 'plan.js', probe: 'E30', expect: 'altered', what: 'hidden events carried as visible (ledger still suppressed)',
    from: 'cue: !!e.cue, hidden: !!e.hidden,', to: 'cue: !!e.cue, hidden: false,' },
  { id: 'L-OTTAVA-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: '8va lines dropped from the output',
    from: "lines.push({ id: s.id, kind: 'ottava',", to: "if (0) lines.push({ id: s.id, kind: 'ottava'," },
  { id: 'L-WEDGE-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'hairpins dropped from the output',
    from: "lines.push({ id: s.id, kind: 'wedge', wedge: s.kind,", to: "if (0) lines.push({ id: s.id, kind: 'wedge', wedge: s.kind," },
  { id: 'L-MARK-OUTPUT', file: 'plan.js', probe: 'burg015', expect: 'missing', what: 'directions (dynamics, words) dropped from the output',
    from: 'marks.push({ id: d.id, kind: d.kind,', to: 'if (0) marks.push({ id: d.id, kind: d.kind,' },
  { id: 'L-PEDAL-MARK', file: 'plan.js', probe: 'piano-marks', expect: 'altered', what: 'a pedal carried without its sign/line mark',
    from: 'mark: cp(s.mark), text: has(s.text) ? s.text : null, soundOnly:', to: 'mark: null, text: has(s.text) ? s.text : null, soundOnly:' },
  { id: 'L-FERMATA-OUTPUT', file: 'plan.js', probe: 'E15', expect: 'missing', what: 'fermatas dropped from the output',
    from: 'fermata: cp(e.fermata), lyrics:', to: 'fermata: null, lyrics:' },
  { id: 'L-LYRIC-OUTPUT', file: 'plan.js', probe: 'E24', expect: 'missing', what: 'lyrics dropped from the output',
    from: 'lyrics: cp(e.lyrics) || [], heads: heads });', to: 'lyrics: [], heads: heads });' },
  { id: 'L-TEMPO-MARK', file: 'plan.js', probe: 'burg015', expect: 'altered', what: 'a tempo carried without its printed mark',
    from: 'mark: cp(x.mark), display: cp(x.display), printed: !!x.mark,', to: 'mark: null, display: cp(x.display), printed: false,' },
  { id: 'L-KEY-OUTPUT', file: 'plan.js', probe: 'E20', expect: 'silent', what: 'key signatures dropped from output and ledger alike',
    from: 'const keys = (tl.keys || []).map(x => {', to: 'const keys = [].map(x => {' },
  { id: 'L-STEM-STATED', file: 'plan.js', probe: 'E12', expect: 'missing', what: 'a stem the graph states not carried',
    from: 'stemStated: d.stem || null,', to: 'stemStated: null,' },
  { id: 'L-GRACE-FLAG', file: 'plan.js', probe: 'E14', expect: 'altered', what: 'grace notes carried as ordinary notes',
    from: 'grace: e.grace ? { order: e.grace.order, slash: !!e.grace.slash, after: after } : null,', to: 'grace: null,' },
  { id: 'L-SLUR-DEFERRED', file: 'plan.js', probe: 'burg015', expect: 'unapproved', what: 'slurs deferred under a code no one approved',
    from: "put({ ref: s.id, kind: 'slur', status: 'drawn', code: open ? 'open' : undefined, plan: s.id });",
    to: "put({ ref: s.id, kind: 'slur', status: 'deferred', code: 'not-yet', plan: s.id });" },
  { id: 'L-MERGED-RATIO', file: 'plan-tuplets.js', probe: 'E07', expect: 'altered', what: 'a merged one-note group shown with another ratio',
    from: 'groups.push({ id: id, events: evIds, actual: a.s.actual, normal: a.s.normal,',
    to: 'groups.push({ id: id, events: evIds, actual: a.s.actual + 1, normal: a.s.normal,' }
];
const CONTROL = { id: 'N1', file: 'plan.js', probe: 'piano-marks', what: 'a comment changed',
  from: '/* ---- analysis that is not notation */', to: '/* ---- analysis, not notation */' };

let tmp = null;
function load(dir) {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(dir)) delete require.cache[k]; });
  return require(path.join(dir, 'engrave', 'index.js'));
}
function withMutation(m, fn) {
  const file = path.join(tmp, 'engrave', m.file);
  const orig = fs.readFileSync(file, 'utf8');
  const text = orig.replace(/\r\n/g, '\n');
  const n = text.split(m.from).length - 1;
  assert.equal(n, 1, m.id + ': the anchor is found exactly once');
  fs.writeFileSync(file, text.replace(m.from, m.to));
  try { return fn(load(tmp)); } finally { fs.writeFileSync(file, orig); }
}

test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-engrave-mut-'));
  ['engrave', 'scoregraph'].forEach(d => fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true }));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

async function probeGraphs() {
  const golden = new Map(goldenGraphs());
  return {
    'G16': golden.get('golden/G16.sg.json'),
    'piano-marks': await graphOf('tests/scoregraph/fixtures/xml/piano-marks.musicxml'),
    'burg015': await graphOf('catalog/method/burgmuller25/015.mxl'),
    'sonatina/002': await graphOf('catalog/method/sonatina/002.mxl'),
    'E07': await graphOf('tests/engrave/fixtures/e/E07-one-note-tuplets.musicxml'),
    'E12': await graphOf('tests/engrave/fixtures/e/E12-two-voices-heads.musicxml'),
    'E14': await graphOf('tests/engrave/fixtures/e/E14-grace.musicxml'),
    'E15': await graphOf('tests/engrave/fixtures/e/E15-articulations.musicxml'),
    'E20': await graphOf('tests/engrave/fixtures/e/E20-key-change.musicxml'),
    'E24': await graphOf('tests/engrave/fixtures/e/E24-lyrics.musicxml'),
    'E30': await graphOf('tests/engrave/fixtures/e/E30-hidden-cue.musicxml')
  };
}

test('every ledger mutation is live and caught under the category it names; the no-op control changes nothing', async (t) => {
  const probes = await probeGraphs();
  const base = load(tmp);
  const baseline = {};
  Object.keys(probes).forEach(k => {
    const p = base.plan(probes[k]);
    assert.ok(base.audit(probes[k], p).ok, k + ' audits clean with the real code');
    baseline[k] = JSON.stringify(p);
  });
  const report = [];
  MUTATIONS.forEach(m => withMutation(m, E => {
    const g = probes[m.probe];
    const p = E.plan(g);
    assert.notEqual(JSON.stringify(p), baseline[m.probe], m.id + ' (' + m.what + '): the output changed - the mutation is live');
    const a = E.audit(g, p);
    assert.equal(a.ok, false, m.id + ' (' + m.what + '): the audit fails');
    assert.ok(a[m.expect].length >= 1, m.id + ': named as ' + m.expect + ' - ' + JSON.stringify({ missing: a.missing.length, silent: a.silent.length, altered: a.altered.length, unapproved: a.unapproved.length }));
    report.push(m.id + ' ' + m.expect + ' ' + a[m.expect].length);
  }));
  withMutation(CONTROL, E => {
    const p = E.plan(probes[CONTROL.probe]);
    assert.equal(JSON.stringify(p), baseline[CONTROL.probe], 'N1: byte-identical output');
    assert.ok(E.audit(probes[CONTROL.probe], p).ok, 'N1: clean audit');
  });
  assert.equal(report.length, MUTATIONS.length);
  t.diagnostic(report.join('; ') + '; N1 byte-identical');
  /* the graphs themselves were never touched */
  Object.keys(probes).forEach(k => assert.ok(Object.isFrozen(probes[k]), k));
  assert.ok(SG.validate(probes['piano-marks']).ok);
});
