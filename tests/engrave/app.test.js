/* G4a in the app: what changed, and what did not (docs/GOALS/G04 §8.2, §25; A45, A46).

   G4a gives every Score on screen a way to its graph and keeps a song's graph beside it. It draws nothing: the legacy
   renderer is byte for byte the one at 55d1bd5, and G3 stays off. The browser side of the same claims is
   tests/engrave/tools/app-source-check.js (the real page, local, like the G2 page checks). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO } = require('./helpers.js');

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const slice = (from, to) => { const i = html.indexOf(from); assert.ok(i >= 0, 'the app has ' + JSON.stringify(from)); const j = html.indexOf(to, i); return html.slice(i, j > 0 ? j : i + 3000); };

/* G4b's layout core is not in the app until the renderer switch (G4f): nothing draws from it, the legacy renderer draws */
const LAYOUT_CORE = ['breaks', 'canon', 'layout', 'metrics', 'practice', 'skyline', 'space'].map(n => 'engrave/' + n + '.js');

test('the app loads every G4a engrave/ file after the scoregraph library and audio-score.js, index.js last - and no G4b layout file', () => {
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

test('A45: the legacy renderer is byte for byte the one at 55d1bd5, and nothing draws from a plan yet', () => {
  /* hashed at 55d1bd5 (LF): the ScoreView class from makeScoreView to its closing brace, and the renderer's head */
  const b = html.indexOf('function makeScoreView(React) {');
  const scoreView = html.slice(b, html.indexOf('\n  };\n}\n', b) + 7);
  assert.equal(sha(scoreView), 'fa5b225d609aff96eb5cc41a1c4e2dcb215783f2306889411328e1f2e08ec3a1');
  const a = html.indexOf('   NOTATION RENDERER (VexFlow)');
  assert.equal(sha(html.slice(a, html.indexOf('\n/* ====', a + 40))), 'b59e39a421ac5d786fd67780ba587938d99b0ed9ee44bcf1455a9eaf9e98b183');
  assert.match(html, /const VEXFLOW_URL = 'https:\/\/cdn\.jsdelivr\.net\/npm\/vexflow@4\.2\.3\/build\/cjs\/vexflow\.js';/, 'the legacy renderer loads what it always loaded');
  assert.doesNotMatch(html, /PPPEngrave\.(plan|audit|identity)\b|vendor\/vexflow/, 'no screen draws from the plan in G4a');
});

test('A46: G3 stays off - G4a turns no G3 switch', () => {
  const as = fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8');
  assert.match(as, /const PROFESSIONAL_DEFAULT = 'off';/);
  const pro = fs.readFileSync(path.join(REPO, 'scoregraph', 'pro.js'), 'utf8');
  assert.match(pro, /g3b: false, ottava: false, pedalJoin: false/);
  assert.doesNotMatch(html, /professional:\s*'(on|shadow)'|pedalJoin:\s*true|g3b:\s*true/);
});
