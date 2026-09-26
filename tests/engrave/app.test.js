/* G4a and G4d-2 in the app: what changed, and what did not (docs/GOALS/G04 §8.2, §16, §25; A45, A46).

   G4a gives every Score on screen a way to its graph and keeps a song's graph beside it. G4d-2 puts the engraver in the
   page behind a switch; G4f-2 flips its default to 'engrave' (G04 §25.2 step 2, DECISIONS G4-U6, G4-F2-1). 'legacy' is
   the rollback, one switch away: under it the legacy renderer draws, byte for byte the one at 55d1bd5 but for MX-1's
   octave lines (A45). G3 stays off. The browser side of the same claims is tests/engrave/tools/app-source-check.js,
   legacy-parity.js and page-check.js (the real page, local, like the G2 page checks; page-check.js --part switch for the
   rollback in the page). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { REPO } = require('./helpers.js');

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const slice = (from, to) => { const i = html.indexOf(from); assert.ok(i >= 0, 'the app has ' + JSON.stringify(from)); const j = html.indexOf(to, i); return html.slice(i, j > 0 ? j : i + 3000); };
const PAGE_FILES = require('./tools/page-files.js');

/* G4b's layout core, G4c's notation and SVG backend, G4d-1a's curves, marks and text metrics, G4d-1b's marks attached to
   systems and G4d-2's page adapter are not in the page's <script> tags: a view under renderer 'engrave' loads them, on
   first use (ENGRAVE_FILES, by content hash). G4f-2: 'engrave' is now the default, so the default page loads them when its
   first full view paints (a reduced view does not - routed first, G4-F2-2); the page's static list is what it was before
   G4d-2, and under ?renderer=legacy nothing more is loaded (the assertion G4d-2 wrote here, "the default page loads what it
   loaded before G4d-2", pinned the old default and is now said of the legacy page - G04 §43) */
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

/* The switch block of the app (ENGRAVE_FILES through engraveView), run in a sandbox: the page's location, storage, console
   and document are stand-ins, so what the switch decides is checked by running it, not by reading it */
/* a view's element: setting innerHTML gives it a first child, as the page's does */
function viewEl() {
  const el = { _h: '', firstChild: null, querySelector: () => null };
  Object.defineProperty(el, 'innerHTML', { set(v) { this._h = v; this.firstChild = v ? { textContent: '' } : null; }, get() { return this._h; } });
  return el;
}
function runSwitch(search, stored, extra) {
  const a = html.indexOf('const ENGRAVE_FILES = [');
  const b = html.indexOf('function makeScoreView(React) {');
  assert.ok(a > 0 && b > a, 'the switch block is before makeScoreView');
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
  const out = vm.runInContext(html.slice(a, b) + '\n;({ ENGRAVE_SWITCH, engraveWanted, engraveView, engraveDrew })', ctx);
  return Object.assign(out, { PPP: window.PPP, scripts, warns });
}

test('G4f-2: the switch defaults to engrave; legacy is one switch away - the URL, storage or PPP.renderer (G04 §16.1, §25; the rollback, tested)', () => {
  const sw = slice('const ENGRAVE_SWITCH = (() => {', '})();');
  /* G4f-2 changed this: G4d-2 pinned renderer: 'legacy' and "r === 'engrave'" - the old default (A30 rule: an assertion that
     pinned the old default changes, with the reason; G04 §43) */
  assert.match(sw, /renderer: 'engrave', strict: false/, 'the default');
  assert.match(sw, /q\.get\('renderer'\) \|\| localStorage\.getItem\('ppp\.renderer'\)/, 'the URL or storage, nothing a person presses');
  assert.match(sw, /if \(r === 'legacy'\) sw\.renderer = 'legacy';/);
  assert.match(html, /const engraveWanted = p => \(p\.renderer \|\| ENGRAVE_SWITCH\.renderer\) === 'engrave';/);
  /* run it: the default, the rollback by URL and by storage, the URL over storage, anything else = the default */
  const cases = [
    ['', null, 'engrave'], ['?renderer=legacy', null, 'legacy'], ['', { 'ppp.renderer': 'legacy' }, 'legacy'],
    ['?renderer=engrave', { 'ppp.renderer': 'legacy' }, 'engrave'], ['?renderer=legacy', { 'ppp.renderer': 'engrave' }, 'legacy'],
    ['?renderer=', { 'ppp.renderer': 'legacy' }, 'legacy'], ['?renderer=vexflow', null, 'engrave'], ['', { 'ppp.renderer': 'LEGACY' }, 'engrave']
  ];
  cases.forEach(([search, stored, want]) => {
    const r = runSwitch(search, stored);
    assert.equal(r.PPP.renderer, want, JSON.stringify([search, stored]));
    assert.equal(r.engraveWanted({}), want === 'engrave');
    /* a view's own prop wins over the switch, both ways */
    assert.equal(r.engraveWanted({ renderer: 'legacy' }), false);
    assert.equal(r.engraveWanted({ renderer: 'engrave' }), true);
  });
  /* at run time: PPP.renderer = 'legacy' is the rollback; anything else is the default */
  const r = runSwitch('', null);
  r.PPP.renderer = 'legacy';
  assert.equal(r.PPP.renderer, 'legacy');
  assert.equal(r.engraveWanted({}), false);
  r.PPP.renderer = 'engrave';
  assert.equal(r.engraveWanted({}), true);
  r.PPP.renderer = 'legacy';
  r.PPP.renderer = 'nonsense';
  assert.equal(r.PPP.renderer, 'engrave');
  assert.deepEqual(r.scripts, [], 'deciding loads nothing');
  /* the only way in: paint() asks engraveWanted first; paintEngrave is called from there alone, engraveView from paintEngrave */
  assert.equal((html.match(/this\.paintEngrave\(\)/g) || []).length, 1);
  assert.match(html, /if \(engraveWanted\(this\.props\) && this\.paintEngrave\(\)\) return;/);
  assert.equal((html.match(/engraveView\(this\)/g) || []).length, 1);
  /* nothing a person presses sets it: PPP.renderer, ?renderer= and localStorage 'ppp.renderer' are its only writers */
  assert.equal((html.match(/ENGRAVE_SWITCH\.renderer = /g) || []).length, 1, 'the PPP.renderer setter');
  assert.doesNotMatch(html.replace(sw, ''), /localStorage\.setItem\('ppp\.renderer'/);
  /* fallbacks are counted and warned, never silent (G04 §16.7) */
  assert.match(slice('function engraveView(view) {', '\n}\n'), /console\.warn\('\[ppp\] engrave fallback', 'LOAD_FAILED'/);
});

test('G4f-2: a reduced view is routed to the legacy renderer before any engraver file is asked for - not a fallback, not warned; a full view loads the engraver (G4-F2-2)', () => {
  const r = runSwitch('', null);
  const el = viewEl();
  const view = { props: null, paint() {} };
  const one = { staves: 1 }, two = { staves: 2 };
  /* the loop thumbnail (clefs: false), the empty page's staff (clefs: false, grand: false), one staff of a grand staff */
  [{ score: two, clefs: false, grand: true }, { score: one, clefs: false, grand: false }, { score: two, grand: false }].forEach(p => {
    assert.equal(r.engraveView(view).paint(el, p), 'legacy', JSON.stringify(p));
  });
  assert.equal(r.ENGRAVE_SWITCH.stats.routed, 3, 'counted as routed');
  assert.equal(Object.keys(r.ENGRAVE_SWITCH.stats.fallbacks).length, 0, 'not as a fallback');
  assert.deepEqual(r.warns, [], 'and not warned');
  assert.deepEqual(r.scripts, [], 'nothing loaded, no "Engraving…"');
  assert.equal(el.innerHTML, '');
  /* the quiz's one-staff score (grand: false on one staff) and a full view are the engraver's: it is loaded, 15 files */
  assert.equal(r.engraveView(view).paint(el, { score: one, grand: false }), 'pending');
  assert.equal(r.scripts.length, PAGE_FILES.ORDER.length);
  assert.match(el.innerHTML, /data-engrave-wait/);
});

test('G4f-2 (review R2): the print command is offered only for a Score the engraver drew - never for one that fell back', () => {
  /* the app's switch block with a stand-in engraver whose views answer as told: the outcome is kept per Score, a fallback is
     sticky, and a change re-renders the app (setState) once */
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
  answer = 'legacy';
  r.engraveView(view).paint(el, { score: two });
  assert.equal(r.engraveDrew(two), false, 'a Score that fell back (SOURCE_DISAGREES) gets no command');
  answer = 'drawn';
  r.engraveView(view).paint(el, { score: two });
  assert.equal(r.engraveDrew(two), false, 'a fallback is sticky');
  answer = 'pending';
  r.engraveView(view).paint(el, { score: three });
  assert.equal(r.engraveDrew(three), false, 'still waiting: no command yet');
  /* the command's condition, and the message when printing still fails */
  assert.match(html, /showPrintControls: S\.wholeScore && engraveWanted\(\{ renderer: PPP\.renderer \}\) && engraveDrew\(S\.score\),/);
  const pr = slice('  printScore() {', '\n  }\n');
  assert.equal((pr.match(/this\.say\(tx\('This score could not be prepared for printing\.'\)\)/g) || []).length, 2, 'a failed print and a failed load both tell the person');
  /* R3: the placeholder text is the app's, translated */
  const rr = runSwitch('', null);
  const el2 = viewEl();
  rr.engraveView(view).paint(el2, { score: one });
  assert.equal(el2.firstChild.textContent, 'tx:Engraving…');
});

test('every producer keeps the graph it made the Score from (G04 §8.2 live)', () => {
  assert.match(slice('function scoreFromXml(xml, name)', '\n}\n'), /return engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(r\.graph/);
  assert.match(slice('async function scoreFromFile(file)', '\n}\n'), /return engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(got\.graph/);
  assert.match(slice("if (kind === 'musicxml' || kind === 'mxl' || kind === 'midi')", 'PDF / photo'), /const score = engraveRemember\(Score\.finalize\(PPPScoreGraph\.legacy\.toScore\(got\.graph[^\n]*'import:' \+ kind\)/);
  assert.match(html, /engraveRemember\(parseMusicXML\(built\.xml, title\), built\.graph, 'recording'\)/);
  assert.equal((html.match(/engraveRemember\(parseMusicXML\(built\.xml, S\.score\.title\), built\.graph, 'rewrite'\)/g) || []).length, 2);
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

test('A45: the legacy renderer is byte for byte the one at 55d1bd5 but for MX-1\'s octave lines and G4d-2\'s two marked insertions, and no screen draws from a plan unless its renderer is \'engrave\'', () => {
  /* hashed at 55d1bd5 (LF): the ScoreView class from makeScoreView to its closing brace, and the renderer's head. MX-1
     (fixer, R1) changed one block of it on purpose - where the octave lines are drawn, so a view of some bars draws the
     stretch of a line it shows. G4d-2 inserted two blocks, each between a "G4d-2 >>>" and a "<<< G4d-2" line: the renderer
     switch at the top of paint(), and paintEngrave() between paint() and draw(). The pin, extended (G4d-2):
       the class as it is now;
       the class with the G4d-2 blocks cut out = the class as MX-1 left it, byte for byte (so draw(), buildVoice(), sync(),
         drawKey() and the rest of paint() are untouched - A45's rollback path);
       that with MX-1's block cut out too = 55d1bd5's class with the same block cut out.
     G4f-2 (review R3) localised one string of the class - the placeholder render() shows until VexFlow is ready, which
     every user sees since the flip - as an inline mark "G4f-2: was <original> >>>" <new> "<<< G4f-2" (in comments). The
     pin puts the original back from the mark before the hashes below, so they prove that string is the only change. */
  const b = html.indexOf('function makeScoreView(React) {');
  const scoreView = html.slice(b, html.indexOf('\n  };\n}\n', b) + 7);
  assert.equal(sha(scoreView), '8f292d3c7e60096cd7c1a3745af53c11c93f401460e8f9592a24088839beb641');
  const MARK = /\/\* G4f-2: was ('[^'\n]*') >>> \*\/([^\n]*?)\/\* <<< G4f-2 \*\//g;
  assert.deepEqual([...scoreView.matchAll(MARK)].map(m => [m[1], m[2]]), [["'Engraving…'", "tx('Engraving…')"]], 'one G4f-2 mark: the placeholder, through tx()');
  const unmarked = scoreView.replace(MARK, '$1');
  assert.equal(sha(unmarked), 'c208062f2f77ed7972319521d12677e071af61db2c95b0c1dd669658d69cf78e', 'the class as G4d-2 left it, byte for byte');
  const blocks = [...unmarked.matchAll(/^[^\n]*\/\* G4d-2 >>>[\s\S]*?\/\* <<< G4d-2 \*\/[^\n]*\n/gm)];
  assert.equal(blocks.length, 2, 'two insertions');
  const before = unmarked.replace(/^[^\n]*\/\* G4d-2 >>>[\s\S]*?\/\* <<< G4d-2 \*\/[^\n]*\n/gm, '');
  assert.equal(sha(before), '8ceb975a9fa3867a7fbc0ef0033b6051aef7f0a6245478417a2cab3bfa49d368', 'outside the two G4d-2 blocks, the class MX-1 left');
  /* where they are: the first statement of paint(), and between paint() and draw() - in none of draw(), buildVoice(), sync() */
  const at = name => scoreView.indexOf('\n    ' + name + '(');
  assert.ok(blocks[0].index > at('paint') && blocks[0].index < at('paintEngrave') && blocks[1].index < at('draw') && at('paintEngrave') < at('draw'));
  assert.match(blocks[0][0], /^\s*\/\* G4d-2 >>>[^\n]*\n\s*if \(engraveWanted\(this\.props\) && this\.paintEngrave\(\)\) return;\n\s*\/\* <<< G4d-2 \*\/\n$/);
  assert.ok(at('draw') < at('buildVoice') && at('buildVoice') < at('sync') && blocks.every(m => m.index < at('draw')));
  const oa = before.indexOf('        const absOfBar = n => Score.startQ(score, n);'), oz = before.indexOf('      /* A segno or coda sign stands');
  assert.ok(oa > 0 && oz > oa, 'the octave-line block is where it was');
  assert.equal(sha(before.slice(0, oa) + before.slice(oz)), '80149fb7729d7b7160f9042c198ea17bad086113f667e247ff464f218cb52248');
  const a = html.indexOf('   NOTATION RENDERER (VexFlow)');
  assert.equal(sha(html.slice(a, html.indexOf('\n/* ====', a + 40))), 'b59e39a421ac5d786fd67780ba587938d99b0ed9ee44bcf1455a9eaf9e98b183');
  assert.match(html, /const VEXFLOW_URL = 'https:\/\/cdn\.jsdelivr\.net\/npm\/vexflow@4\.2\.3\/build\/cjs\/vexflow\.js';/, 'the legacy renderer loads what it always loaded');
  /* the app itself never draws from a plan: the engraver's path is engrave/page.js, behind the switch (above) */
  assert.doesNotMatch(html, /PPPEngrave\.(plan|audit|identity)\b|vendor\/vexflow/, 'no screen draws from a plan in the app file');
});

test('A46: G3 stays off - G4a turns no G3 switch', () => {
  const as = fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8');
  assert.match(as, /const PROFESSIONAL_DEFAULT = 'off';/);
  const pro = fs.readFileSync(path.join(REPO, 'scoregraph', 'pro.js'), 'utf8');
  assert.match(pro, /g3b: false, ottava: false, pedalJoin: false/);
  assert.doesNotMatch(html, /professional:\s*'(on|shadow)'|pedalJoin:\s*true|g3b:\s*true/);
});
