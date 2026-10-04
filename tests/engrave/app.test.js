/* G4a and G4d-2 in the app: what changed, and what did not (docs/GOALS/G04 §8.2, §16, §25, §52; A46).

   G4a gives every Score on screen a way to its graph and keeps a song's graph beside it. G4d-2 puts the engraver in the
   page. It was first behind a dev-only switch (G4f-2 flipped the default to 'engrave', G04 §25.2 step 2, DECISIONS
   G4-U6, G4-F2-1; 'legacy' was the rollback, one switch away). §25.2 step 3 removed the switch and the old VexFlow-based
   renderer it could fall back to (DECISIONS G4-R3, G4-R4): the engraver is now the only renderer, a reduced view (no
   clefs, one staff of several) draws like any other, and a genuine engraving failure shows this view's own "could not
   be engraved" message rather than a second renderer's drawing. A45's byte-for-byte pin of the removed renderer is
   retired with it - there is nothing left to pin against; the engraver's own output stability is
   tests/engrave/tools/layout-hashes.js's baselines. G3 stays off. The browser side of the same claims is
   tests/engrave/tools/app-source-check.js and page-check.js (the real page, local, like the G2 page checks). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO } = require('./helpers.js');

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
const slice = (from, to) => { const i = html.indexOf(from); assert.ok(i >= 0, 'the app has ' + JSON.stringify(from)); const j = html.indexOf(to, i); return html.slice(i, j > 0 ? j : i + 3000); };
const PAGE_FILES = require('./tools/page-files.js');

/* G4b's layout core, G4c's notation and SVG backend, G4d-1a's curves, marks and text metrics, G4d-1b's marks attached to
   systems and G4d-2's page adapter are not in the page's <script> tags: every ScoreView loads them, on first use
   (ENGRAVE_FILES, by content hash) - the page's static <script> list is what it was before G4d-2 ever ran. */
const LAYOUT_CORE = PAGE_FILES.ORDER.map(n => 'engrave/' + n + '.js');

test('the app loads every G4a engrave/ file after the scoregraph library and audio-score.js, index.js last - and the layout files and page.js only on demand', () => {
  const srcs = [...html.matchAll(/<script src="\.\/((?:scoregraph\/[\w-]+|engrave\/[\w-]+|audio-score)\.js)\?v=[^"]*"><\/script>/g)].map(m => m[1]);
  const a = srcs.indexOf('audio-score.js');
  const eng = srcs.filter(s => s.startsWith('engrave/'));
  const files = fs.readdirSync(path.join(REPO, 'engrave')).filter(f => f.endsWith('.js')).map(f => 'engrave/' + f);
  LAYOUT_CORE.forEach(f => assert.ok(files.indexOf(f) >= 0 && eng.indexOf(f) < 0, f + ' exists and the app does not load it'));
  assert.deepEqual(eng.slice().sort(), files.filter(f => LAYOUT_CORE.indexOf(f) < 0).sort());
  assert.ok(srcs.indexOf(eng[0]) > a, 'after audio-score.js, so the library is in place');
  assert.equal(eng[eng.length - 1], 'engrave/index.js');
  const order = ['ledger', 'glyphs', 'plan-beams', 'plan-tuplets', 'plan', 'store', 'source', 'index'].map(n => 'engrave/' + n + '.js');
  assert.deepEqual(eng, order, 'each after what it needs');
  /* G4d-2: the engraver's files are named once, in the order they read each other, each by its current content hash
     (tests/engrave/tools/page-files.js --write), and loaded by loadEngrave() alone */
  assert.deepEqual(PAGE_FILES.check(), [], 'node tests/engrave/tools/page-files.js --write');
  assert.equal(LAYOUT_CORE.length, files.filter(f => order.indexOf(f) < 0).length, 'every other engrave/ file is loaded on demand');
  const loader = slice('function loadEngrave() {', '\n}\n');
  assert.match(loader, /s\.src = '\.\/engrave\/' \+ name \+ '\.js\?h=' \+ hash;/);
  assert.match(loader, /s\.async = false;/, 'in order');
  /* defined once, called from the engraver's view (G4d-2) and G4e's print command (printScore()) - both need the
     layout core and page.js, and both are on the same switch (on by default since the G4f-2 flip) */
  assert.equal((html.match(/loadEngrave\(\)/g) || []).length, 3, 'defined once, called from the engraver\'s view and the print command');
});

/* engraveView (ENGRAVE_FILES through it), run in a sandbox: the page's location, storage, console and document are
   stand-ins, so what it decides is checked by running it, not by reading it */
/* a view's element: setting innerHTML gives it a first child, as the page's does */
function viewEl() {
  const el = { _h: '', firstChild: null, querySelector: () => null };
  Object.defineProperty(el, 'innerHTML', { set(v) { this._h = v; this.firstChild = v ? { textContent: '', getAttribute: () => null } : null; }, get() { return this._h; } });
  return el;
}
function runSwitch(search, stored, extra) {
  const a = html.indexOf('const ENGRAVE_FILES = [');
  const b = html.indexOf('function makeScoreView(React) {');
  assert.ok(a > 0 && b > a, 'the engraver-in-the-page block is before makeScoreView');
  const scripts = [], warns = [];
  const document = { head: { appendChild: s => scripts.push(s.src) }, createElement: () => ({}) };
  const window = { PPP: {} };
  const ctx = vm.createContext({
    window, document, URLSearchParams,
    location: { search: search || '' },
    localStorage: { getItem: k => (stored && k in stored ? stored[k] : null) },
    console: { warn: function () { warns.push([...arguments].join(' ')); } },
    /* the app's i18n (G4f-2 R3): the page's placeholder text goes through it */
    tx: s => 'tx:' + s,
    scoreNoteEnd: () => 0,
    setTimeout: (f) => f()
  });
  if (extra) extra(window);
  const out = vm.runInContext(html.slice(a, b) + '\n;({ ENGRAVE_STATE, engraveView, engraveDrew })', ctx);
  return Object.assign(out, { PPP: window.PPP, scripts, warns });
}

test('§25.2 step 3 (DECISIONS G4-R3, G4-R4): there is no more renderer switch - PPP.strictEngrave is the only knob left', () => {
  /* code, not prose: the doc comments above ENGRAVE_STATE are allowed to name the old PPP.renderer switch for history */
  assert.doesNotMatch(html, /const ENGRAVE_SWITCH\b|\bfunction engraveWanted\b|q\.get\('renderer'\)|renderer:\s*\{\s*enumerable/,
    'the switch itself, its getter/setter and its URL parsing are gone');
  const st = slice('const ENGRAVE_STATE = (() => {', '})();');
  assert.match(st, /st\.strict = q\.get\('strict'\) === '1' \|\| localStorage\.getItem\('ppp\.strictEngrave'\) === '1';/,
    'strict mode is the only thing still read from the URL or storage');
  assert.match(html, /strictEngrave: \{ enumerable: true, get: \(\) => ENGRAVE_STATE\.strict, set: v => \{ ENGRAVE_STATE\.strict = !!v; \} \}/,
    'PPP.strictEngrave stays (question 3): throw instead of showing the failure state, for CI and tests that must fail loudly');
  /* nothing a person presses sets it: ?strict=1 and localStorage 'ppp.strictEngrave' are its only writers, same as before */
  assert.doesNotMatch(html.replace(st, ''), /localStorage\.setItem\('ppp\.(renderer|strictEngrave)'/);
  /* the only way in: paint() calls engraveView directly now - paintEngrave folded into it, nothing left to fall through to */
  assert.equal((html.match(/engraveView\(this\)/g) || []).length, 1);
  assert.doesNotMatch(html, /this\.paintEngrave\(\)/);
  /* fallbacks are still counted and warned, never silent (G04 §16.7) */
  assert.match(slice('function engraveView(view) {', '\n  };\n}\n'), /console\.warn\('\[ppp\] engrave fallback', 'LOAD_FAILED'/);
});

test('§25.2 step 3 (DECISIONS G4-R3): a view that used to be routed to the legacy renderer (no clefs, one staff of a grand score) now loads the engraver like any other view', () => {
  const r = runSwitch('', null);
  const el = viewEl();
  const view = { props: null, paint() {} };
  const one = { staves: 1 }, two = { staves: 2 };
  /* the loop thumbnail (clefs: false), the empty page's staff (clefs: false, grand: false), one staff of a grand staff */
  [{ score: two, clefs: false, grand: true }, { score: one, clefs: false, grand: false }, { score: two, grand: false }].forEach(p => {
    assert.equal(r.engraveView(view).paint(el, p), 'pending', JSON.stringify(p));
  });
  assert.equal(r.scripts.length, PAGE_FILES.ORDER.length, 'the engraver\'s 15 files are asked for, same as any other view');
  assert.match(el.innerHTML, /data-engrave-wait/, '"Engraving…" while they load, same as any other view');
  assert.equal(Object.keys(r.ENGRAVE_STATE.stats.fallbacks).length, 0, 'not a fallback - these views draw normally now');
  assert.deepEqual(r.warns, [], 'and not warned');
});

test('a genuine engraving failure shows this view\'s own "could not be engraved" message, not a blank screen (DECISIONS G4-R4)', () => {
  const ev = slice('function engraveView(view) {', '\n  };\n}\n');
  assert.match(ev, /showFailed\(el\);\s*\n\s*engraveOutcome\(p\.score, 'failed'\);\s*\n\s*return 'failed';/,
    'a load failure (window.PPPEngravePage never appears) shows the placeholder and reports \'failed\' - never stuck pending forever, never blank');
  assert.match(ev, /d\.textContent = tx\('This passage could not be engraved\.'\);/, 'the same wording the app already used for a per-song drawing problem');
  assert.match(html, /failText: \(\) => tx\('This passage could not be engraved\.'\),/,
    'engrave/page.js\'s own failure placeholder (once it has loaded) is wired to the same, translated text');
  /* the placeholder is idempotent: repainting an already-failed score every sync frame during playback must not touch the DOM again */
  assert.match(ev, /data-engrave-failed/);
});

test('G4f-2 (review R2), unchanged by §25.2 step 3: the print command is offered only for a Score the engraver drew', () => {
  /* a stand-in engraver whose views answer as told: the outcome is kept per Score, a failure is sticky, and a change
     re-renders the app (setState) once */
  let answer = 'drawn', renders = 0;
  const one = { staves: 1 }, two = { staves: 1 }, three = { staves: 1 };
  const r = runSwitch('', null, window => {
    window.PPPEngravePage = { createView: () => ({ paint: () => answer }) };
    window.PPP.app = { state: { score: one }, setState: () => { renders++; } };
  });
  const el = viewEl();
  const view = { props: null, paint() {} };
  assert.equal(r.engraveDrew(one), false, 'not before it is drawn');
  assert.equal(r.engraveView(view).paint(el, { score: one }), 'drawn');
  assert.equal(r.engraveDrew(one), true);
  assert.equal(renders, 1, 'the app re-rendered once, so the command appears');
  r.engraveView(view).paint(el, { score: one });
  assert.equal(renders, 1, 'no change, no render');
  answer = 'failed';
  r.engraveView(view).paint(el, { score: two });
  assert.equal(r.engraveDrew(two), false, 'a Score whose engraving failed (SOURCE_DISAGREES) gets no command');
  answer = 'drawn';
  r.engraveView(view).paint(el, { score: two });
  assert.equal(r.engraveDrew(two), false, 'a failure is sticky');
  answer = 'pending';
  r.engraveView(view).paint(el, { score: three });
  assert.equal(r.engraveDrew(three), false, 'still waiting: no command yet');
  /* the command's condition, and the message when printing still fails */
  assert.match(html, /showPrintControls: S\.wholeScore && engraveDrew\(S\.score\),/);
  const pr = slice('  printScore() {', '\n  }\n');
  assert.equal((pr.match(/this\.say\(tx\('This score could not be prepared for printing\.'\)\)/g) || []).length, 2, 'a failed print and a failed load both tell the person');
  /* R3: the placeholder text is the app's, translated */
  const rr = runSwitch('', null);
  const el2 = viewEl();
  rr.engraveView(view).paint(el2, { score: one });
  assert.equal(el2.firstChild.textContent, 'tx:Engraving…');
});

test('every producer keeps the graph it made the Score from (G04 §8.2 live)', () => {
  /* G5c's graphForScore(r.graph) (PPP.fingering) now sits between the import and toScore() here - a real
     value that may differ from what musicxml.import() produced when the switch is on. The invariant this
     test guards survives that unchanged: the SAME local `graph` must still reach both toScore() (what is
     drawn) and engraveRemember()'s own graph argument (what is kept beside the Score, G4a) - never two
     graphs that merely look alike. \1 below is a backreference, not a repeated literal, so it actually
     enforces that identity: it would stop matching if a future change let toScore() and engraveRemember()
     diverge onto two different graphs. */
  assert.match(slice('function scoreFromXml(xml, name)', '\n}\n'),
    /const (\w+) = graphForScore\(r\.graph\);\s*return engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(\1, \{ name: name \}\)\), \1, 'musicxml-text'\);/);
  assert.match(slice('async function scoreFromFile(file)', '\n}\n'), /return engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(got\.graph/);
  assert.match(slice("if (kind === 'musicxml' || kind === 'mxl' || kind === 'midi')", 'PDF / photo'), /const score = engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(got\.graph[^\n]*'import:' \+ kind\)/);
  assert.match(html, /engraveRemember\(parseMusicXML\(built\.xml, title\), built\.graph, 'recording'\)/);
  /* the rhythm rewrite, the heard-notes rewrite, and G10a-4's "Write the notation again" */
  assert.equal((html.match(/engraveRemember\(parseMusicXML\(built\.xml, S\.score\.title\), built\.graph, 'rewrite'\)/g) || []).length, 3);
  assert.match(html, /engraveRememberXml\(parseMusicXML\(heard\.xml, heard\.title \|\| title\), heard\.xml, 'catalog-match'\)/);
  assert.match(html, /scoreXml = mergedXml;[\s\S]{0,4000}engraveRememberXml\(score, scoreXml, 'omr'\)/);
  /* the helpers never throw into an import or a save */
  ['function engraveRemember(', 'function engravePersist(', 'function engraveForget('].forEach(f => assert.match(slice(f, '\n}\n'), /try \{/));
});

test('a song keeps its graph when its slot is written, and loses it when the song is removed (G4-U1)', () => {
  const w = slice('  writeSlot() {', '\n  storageFull() {');
  assert.match(w, /localStorage\.setItem\(SONG_KEY \+ id, JSON\.stringify\(slot\)\);[\s\S]*engravePersist\(id, S\.score\);[\s\S]*return true;/, 'after the slot is safely written');
  assert.match(slice('  removeSong(id, opts) {', '\n  /* ===='), /MediaStore\.del\(id\);\n\s*engraveForget\(id\);/);
  /* nothing about a graph goes into the object that is serialised whole into localStorage (G2-D14) */
  const slotObject = w.slice(w.indexOf('const slot = {'), w.indexOf('};', w.indexOf('const slot = {')));
  assert.ok(slotObject.length > 100);
  assert.doesNotMatch(slotObject, /graph/i);
});

/* A45 pinned the legacy renderer byte for byte (55d1bd5, but for MX-1's octave lines and G4d-2's two marked insertions)
   so a change to it would be seen and justified. §25.2 step 3 removed that renderer - draw(), buildVoice(), sync(),
   drawKey() and the VexFlow loader are gone, so there is nothing left to pin against, and A45 retires with it. What
   replaces it is not a new byte-pin here: the engraver's own default output is already held stable by
   tests/engrave/tools/layout-hashes.js's committed baselines (every E fixture, R corpus score and transcription, at
   both screen configs and print) - that mechanism did not change and did not need to. This test instead guards the
   removal itself: that the old renderer, its CDN load and its switch are actually gone, not just unreachable. */
test('§25.2 step 3: the legacy renderer, the VexFlow CDN load and the switch are gone - the app never draws from a plan except through the engraver', () => {
  /* actual code, not the historical prose explaining why it is gone (which is allowed to name what used to be here) */
  assert.doesNotMatch(html, /window\.Vex\b|Vex\.Flow|\bfunction loadVexFlow\b|VEXFLOW_URL|\bACC_VEX\b|\bvexKeySig\(|\bvexKey\(|\bvexAccidental\(/,
    'no VexFlow API, loader or helper left - the vendored copy engrave/\'s own build tools use is a separate file (make-metrics.js, make-outlines.js), never loaded here');
  assert.doesNotMatch(html, /function draw\(\)|buildVoice\(VF|\bdrawKey\(\)/, 'the legacy draw methods are gone');
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/vexflow/, 'no VexFlow CDN load (the app still loads other libraries this way - PDF.js, the transcription models - untouched)');
  assert.doesNotMatch(html, /const ENGRAVE_SWITCH\b|\bfunction engraveWanted\b/, 'no renderer switch');
  /* the app itself never draws from a plan: the engraver's path is engrave/page.js, the only renderer now */
  assert.doesNotMatch(html, /PPPEngrave\.(plan|audit|identity)\b|vendor\/vexflow/, 'no screen draws from a plan in the app file');
  /* the ScoreView class itself: just enough left to hand a view to the engraver and let it draw */
  const b = html.indexOf('function makeScoreView(React) {');
  const scoreView = html.slice(b, html.indexOf('\n  };\n}\n', b) + 7);
  ['componentDidMount', 'componentDidUpdate', 'componentWillUnmount', 'paint', 'render'].forEach(m =>
    assert.match(scoreView, new RegExp('\\n {4}' + m + '\\('), m + ' is still here'));
  ['draw', 'buildVoice', 'sync', 'drawKey', 'paintEngrave'].forEach(m =>
    assert.doesNotMatch(scoreView, new RegExp('\\n {4}' + m + '\\('), m + ' is gone'));
});

test('A46: G3 stays off - G4a turns no G3 switch', () => {
  const as = fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8');
  assert.match(as, /const PROFESSIONAL_DEFAULT = 'off';/);
  const pro = fs.readFileSync(path.join(REPO, 'scoregraph', 'pro.js'), 'utf8');
  assert.match(pro, /g3b: false, ottava: false, pedalJoin: false/);
  assert.doesNotMatch(html, /professional:\s*'(on|shadow)'|pedalJoin:\s*true|g3b:\s*true/);
});
