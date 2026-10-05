/* G10b-0: the engine comparison of the H-10 review - the same pieces from the in-browser model's notes and from the helper's, both written by the page's v2 conversion.
   Pure and Node-only (the page in a browser is tests/review/h10-engine-page.test.js): the helper-notes converter, the bar agreement, whole packets built from
   heard-notes fixtures (real Onsets & Frames runs on rendered public-domain scores, tests/bench/replay-of) against SYNTHETIC helper notes derived from them (nothing
   of the teacher's pieces is in the repository): the blind assignment, the same seconds for both readings (chosen from the browser's notes), what is drawn against the
   Score, part A only when the arranger accepts both, the vocabulary scan and its mutation test, skipped pieces reported, and the decode of fake answers against the key. */
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, heardDirs, heardOf, helperRaw, leakScan, LEAK, tmpDir } = require('./h10-helpers.js');
const { readAll } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const { decode, report } = require(path.join(REPO, 'review/decode.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
const PACKET = require(path.join(REPO, 'review/h10/packet.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));
const EX = require(path.join(REPO, 'review/lib/h10-excerpt.js'));
const HELPER = require(path.join(REPO, 'review/h10/helper-heard.js'));

const SEED = 'g10b0-test-secret-seed-0123456789';
const NAMES = ['nearer', 'know', 'notone'];
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/* the jobs buildH10 makes, so one set of built items can serve several packets (the arranger takes seconds a piece) */
const jobsOf = (dirs, names, extra) => names.map(n => Object.assign({ id: n, title: 'Piece ' + n, heard: json(path.join(dirs.heard, n + '.json')), heardB: json(path.join(dirs.heardB, n + '.json')), compare: 'engine', excerpt: {} }, extra || {}));
const build = (dirs, extra, tag) => buildPacket(Object.assign({ mode: 'h10', compare: 'engine', seed: SEED, heard: dirs.heard, heardB: dirs.heardB, out: path.join(tmpDir('eng' + (tag || '')), 'packet'), keyOut: path.join(tmpDir('engk' + (tag || '')), 'key'), jobs: 1 }, extra || {}));

let D, built, A, html, manifestText, key;
before(async () => {
  D = heardDirs(NAMES);
  built = await PACKET.buildItems(jobsOf(D, NAMES), { jobs: 1 });
  A = await build(D, { results: built }, 'a');
  html = fs.readFileSync(A.files.html, 'utf8');
  manifestText = fs.readFileSync(A.files.manifest, 'utf8');
  key = json(A.files.key);
});

/* ---- the helper's notes -> heard notes ---- */
test('the converter keeps the accepted notes as { on, off, midi, vel } and nothing else: no pedal, no beats, no confidence; the uncertain notes are only counted', () => {
  const raw = helperRaw(heardOf('know'));
  raw.beats = [0.5, 1, 1.5]; raw.downbeats = [0.5];
  const c = HELPER.convertHelperNotes(raw);
  assert.equal(c.heard.notes.length, raw.notes.length);
  c.heard.notes.forEach(n => assert.deepEqual(Object.keys(n), ['on', 'off', 'midi', 'vel']));
  assert.equal(c.heard.pedals, undefined); assert.equal(c.heard.beats, undefined); assert.equal(c.heard.downbeats, undefined); assert.equal(c.heard.grid, undefined);
  assert.equal(c.heard.duration, raw.duration); assert.equal(c.heard.engine, 'ensemble'); assert.equal(c.heard.truncated, false);
  assert.equal(c.heard.helper.uncertain, raw.uncertainNotes.length); assert.equal(c.heard.helper.pedalSpansDropped, 2); assert.equal(c.heard.helper.accepted, raw.notes.length);
  assert.ok(raw.uncertainNotes.length > 0, 'the fixture has uncertain notes');
  /* sorted by onset, then pitch; the uncertain ones are not among the notes */
  for (let i = 1; i < c.heard.notes.length; i++) { const a = c.heard.notes[i - 1], b = c.heard.notes[i]; assert.ok(a.on < b.on || (a.on === b.on && a.midi <= b.midi)); }
  assert.deepEqual(c.report, { notes: raw.notes.length, dropped: 0, uncertain: raw.uncertainNotes.length, pedalsDropped: 2, duration: raw.duration });
  /* readable by the builder's own reader */
  const dir = tmpDir('hconv'); fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ id: 'x' }])); fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(c.heard));
  assert.equal(PACKET.readHeardDir(dir).items[0].heard.notes.length, raw.notes.length);
});

test('the converter drops what is not a note (reported), clamps a velocity, and refuses a file that is not helper notes or holds too few', () => {
  const raw = { duration: 10, notes: [{ on: 0, off: 1, midi: 60, vel: 300 }, { on: 1, off: 2, midi: 62 }, { on: 2, off: 3, midi: 64, vel: 0 }, { on: 3, off: 4, midi: 65, vel: 50 }, { on: 5, off: 4, midi: 60, vel: 50 },
    { on: NaN, off: 4, midi: 60 }, { on: 1, off: 2, midi: 12, vel: 50 }, { on: 6, off: 7, midi: 67.4, vel: 80.6 }, null] };
  const c = HELPER.convertHelperNotes(raw);
  assert.equal(c.report.notes, 5); assert.equal(c.report.dropped, 4);
  assert.deepEqual(c.heard.notes.map(n => [n.midi, n.vel]), [[60, 127], [62, 64], [64, 1], [65, 50], [67, 81]]);
  assert.throws(() => HELPER.convertHelperNotes({ error: 'cuda out of memory' }), /not a helper notes file.*cuda out of memory/);
  assert.throws(() => HELPER.convertHelperNotes(null), /not a helper notes file/);
  assert.throws(() => HELPER.convertHelperNotes({ notes: raw.notes.slice(0, 3) }), /needs at least 4/);
  assert.equal(HELPER.convertHelperNotes({ notes: raw.notes.slice(0, 4).concat([{ on: 7, off: 8, midi: 70 }]) }).heard.duration, 8, 'no duration: the end of the last note');
});

test('the folder converter reads <root>/<id>/<file> or <root>/<id>.json, writes a heard folder (items.json copied), says what is missing; the command line does the same', () => {
  const heard = tmpDir('hf-heard'), root = tmpDir('hf-root'), out = tmpDir('hf-out');
  fs.writeFileSync(path.join(heard, 'items.json'), JSON.stringify([{ id: 'p1', url: 'https://youtu.be/aaaaaaaaaaa' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]));
  fs.mkdirSync(path.join(root, 'p1')); fs.writeFileSync(path.join(root, 'p1', 'notes-cuda.json'), JSON.stringify(helperRaw(heardOf('know'))));
  fs.writeFileSync(path.join(root, 'p2.json'), JSON.stringify(helperRaw(heardOf('nearer'))));
  fs.mkdirSync(path.join(root, 'p3')); fs.writeFileSync(path.join(root, 'p3', 'notes-cuda.json'), '{"error":"failed"}');
  const r = HELPER.convertFolder({ root: root, heardDir: heard, outDir: out });
  assert.deepEqual(r.written.map(w => w.id), ['p1', 'p2']);
  assert.deepEqual(r.missing.map(m => m.id), ['p3', 'p4']);
  assert.match(r.missing[0].reason, /not a helper notes file/); assert.match(r.missing[1].reason, /no notes-cuda\.json/);
  assert.deepEqual(fs.readdirSync(out).sort(), ['items.json', 'p1.json', 'p2.json']);
  assert.equal(json(path.join(out, 'items.json')).length, 4);
  const out2 = path.join(tmpDir('hf-out2'), 'sub');
  const run = spawnSync(process.execPath, [path.join(REPO, 'review/h10/helper-heard.js'), '--from', root, '--heard', heard, '--out', out2], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /p1: \d+ helper notes/); assert.match(run.stdout, /MISSING p3/); assert.match(run.stdout, /2 converted, 2 missing/);
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'review/h10/helper-heard.js')], { encoding: 'utf8' }).status, 2, 'no arguments: usage');
});

/* ---- how far the two readings agree ---- */
test('barAgreement: the same bars agree; a tempo octave, another metre and bars that start on other beats are each flagged, and a double-length bar that lines up is not "phase"', () => {
  const starts = (n, len, off) => Array.from({ length: n + 1 }, (_, i) => (off || 0) + i * len);
  const mk = (n, len, off, tempo, metre) => ({ starts: starts(n, len, off), tempo: tempo, metre: metre || '4/4', beatsPerBar: +(metre || '4/4').split('/')[0], barSeconds: len });
  const same = ITEM.barAgreement(mk(40, 2, 0, 120), mk(40, 2, 0.01, 120));
  assert.deepEqual(same.flags, []); assert.equal(same.alignedShare, 1); assert.equal(same.phaseBeats, 0);
  const octave = ITEM.barAgreement(mk(40, 2, 0, 120), mk(80, 1, 0, 240));
  assert.deepEqual(octave.flags, ['tempo-octave']); assert.equal(octave.tempoRatio, 2); assert.equal(octave.barRatio, 0.5); assert.equal(octave.alignedShare, 1);
  const phase = ITEM.barAgreement(mk(40, 2, 0, 120), mk(40, 2, 1, 120));   /* the other reading's barlines fall two beats later */
  assert.deepEqual(phase.flags, ['bar-phase']); assert.equal(phase.alignedShare, 0); assert.ok(Math.abs(phase.phaseBeats - 2) < 0.01, 'two beats: ' + phase.phaseBeats);
  const metre = ITEM.barAgreement(mk(40, 2, 0, 120, '4/4'), mk(53, 1.5, 0, 120, '3/4'));
  assert.ok(metre.flags.includes('metre')); assert.equal(metre.sameMetre, false);
  const slow = ITEM.barAgreement(mk(40, 2, 0, 120), mk(27, 3, 0, 80));
  assert.ok(slow.flags.includes('bar-length'));
  /* the excerpt is judged on its own: bars that agree for most of the piece but not where the reviewer looks are flagged, and the reverse is not */
  const a = mk(40, 2, 0, 120), half = mk(40, 2, 0, 120);
  half.starts = half.starts.map((t, i) => i < 30 ? t : t + 1);   /* the last ten bars start two beats late */
  const late = ITEM.barAgreement(a, half, [62, 80]), early = ITEM.barAgreement(a, half, [10, 30]);
  assert.equal(late.alignedShare, 0.75); assert.equal(late.window.alignedShare, 0); assert.ok(late.flags.includes('bar-phase'), 'misaligned where the teacher looks');
  assert.equal(early.window.alignedShare, 1); assert.deepEqual(early.flags, [], 'agreeing where she looks, and in most of the piece');
  assert.equal(ITEM.barAgreement(a, half).window, null, 'no window given: whole-piece numbers only');
});

test('the excerpt window is chosen from the arms named for its length only (lengthArms), and every arm still shows the bars that cover it', () => {
  const heard = []; for (let i = 0; i < 400; i++) heard.push({ on: i * 0.5, off: i * 0.5 + 0.4, midi: 60 });
  const bs = (n, len) => Array.from({ length: n + 1 }, (_, i) => i * len);
  const both = EX.pickExcerpt({ heard: heard, barStarts: { browser: bs(100, 2), helper: bs(200, 1) } });
  const browser = EX.pickExcerpt({ heard: heard, barStarts: { browser: bs(100, 2), helper: bs(200, 1) }, lengthArms: ['browser'] });
  assert.equal(browser.seconds, 24, 'twelve of the browser\'s bars');
  assert.equal(both.seconds, 18, 'the mean of the two arms\' bars by default');
  assert.equal(browser.arms.browser.count, 12); assert.ok(browser.arms.helper.count >= 24, 'the other reading, with shorter bars, shows more of them for the same seconds');
  [browser.arms.browser, browser.arms.helper].forEach(a => { assert.ok(a.covers[0] <= browser.start + 1e-6 && a.covers[1] >= browser.end - 1e-6); });
});

test('an item is windowed by what the BROWSER heard: when the helper\'s notes would pick another stretch, the item still shows the browser\'s, for both readings', async () => {
  /* a steady tune, eighth notes at 120 bpm for 100 s; the helper's notes lack a stretch in the middle (45-75 s), so a window chosen from them would avoid the middle */
  const tune = [60, 64, 67, 72, 67, 64, 62, 65];
  const browser = []; for (let i = 0; i < 400; i++) browser.push({ on: i * 0.25, off: i * 0.25 + 0.22, midi: tune[i % 8], vel: 70 });
  const helper = browser.filter(n => n.on < 45 || n.on >= 75).map(n => Object.assign({}, n));
  const stub = { arranger: { arrange: async () => ({ ok: false, reason: 'stub' }) } };
  const r = await ITEM.buildEngineItem({ id: 'syn', title: 'syn', heard: { notes: browser, duration: 100 }, heardB: { notes: helper, duration: 100 }, compare: 'engine' }, stub);
  const fromBrowser = EX.chooseWindow(browser, { seconds: r.excerpt.seconds }), fromHelper = EX.chooseWindow(helper, { seconds: r.excerpt.seconds });
  assert.notEqual(fromBrowser.start, fromHelper.start, 'the two note sets would choose different windows (the test discriminates)');
  assert.equal(r.excerpt.start, fromBrowser.start); assert.equal(r.excerpt.end, fromBrowser.end);
  assert.ok(Math.abs((r.excerpt.start + r.excerpt.end) / 2 - 50) < 2, 'the middle of the piece');
  ['browser', 'helper'].forEach(a => assert.ok(r.arms[a].key.covers[0] <= r.excerpt.start + 1e-6 && r.arms[a].key.covers[1] >= r.excerpt.end - 1e-6, a + ' covers the browser window'));
  assert.ok(r.heardIn.helper < r.heardIn.browser / 2, 'the helper lacks most of the notes of that window: the comparison shows exactly that (' + r.heardIn.helper + ' against ' + r.heardIn.browser + ')');
});

/* ---- the packet ---- */
test('the packet is two files; X and Y have the same fields for every piece and the manifest says nothing of the sources', () => {
  assert.deepEqual(Object.keys(readAll(A.outDir)), ['index.html', 'manifest.json']);
  const m = json(A.files.manifest);
  assert.equal(m.review, 'H-10'); assert.equal(m.items.length, 3);
  assert.equal(m.items.map(i => i.id).join(','), 'i01,i02,i03');
  m.items.forEach(it => { assert.deepEqual(it.versions, [{ label: 'X' }, { label: 'Y' }]); assert.ok(it.excerpt.endSeconds > it.excerpt.startSeconds); assert.ok(it.parts[0] === 'T'); });
  ['seed', 'v2', 'classic', 'hmac', 'assign', 'key', 'browser', 'helper', 'engine', 'ensemble', 'compare'].forEach(w => assert.ok(manifestText.toLowerCase().indexOf(w) < 0, 'manifest mentions ' + w));
  assert.ok(html.indexOf('H-10b 악보 비교') > 0);
  assert.ok(html.indexOf('두 가지로 듣고') > 0 && html.indexOf('두 가지 방법') < 0, 'the engine introduction: two readings of one recording, not "two ways to write it"');
  assert.match(A.packetId, /^[0-9a-f]{12}$/);
});

test('the key says which of X and Y is which per piece (an even split by HMAC of the seed), both arms are the v2 conversion, and the facts of each reading are in it', () => {
  assert.equal(key.mode, 'h10'); assert.equal(key.compare, 'engine'); assert.equal(key.seed, SEED); assert.equal(key.packetId, A.packetId); assert.ok(key.builtFrom);
  assert.equal(key.passRule, undefined, 'no v2-against-classic starting rule here');
  assert.deepEqual(Object.keys(key.arms), ['browser', 'helper']); assert.match(key.question, /helper ensemble/);
  const ids = Object.keys(key.items);
  assert.equal(ids.length, 3);
  assert.equal(ids.filter(id => key.items[id].X === 'browser').length, 2, 'three pieces: one more X-is-browser (an even split: n odd gives one more of the first arm)');
  ids.forEach(id => {
    const it = key.items[id];
    assert.ok(['browser', 'helper'].includes(it.X) && ['browser', 'helper'].includes(it.Y) && it.X !== it.Y);
    ['browser', 'helper'].forEach(a => {
      const x = it.arms[a];
      assert.equal(x.wroteV2, true, a + ' of ' + id + ' was written by v2'); assert.equal(typeof x.v2Rejected, 'boolean');
      assert.ok(x.whole.bars > 0 && x.whole.tempo > 0 && /^\d+\/\d+$/.test(x.whole.metre) && x.whole.heads > 0 && x.whole.rests >= 0, 'whole-piece facts');
      assert.ok(x.heardNotesInWindow > 0 && x.counts.T.score.heads > 0);
    });
    assert.equal(it.heard.browser.notes, heardOf(it.source.id).notes.length);
    assert.equal(it.heard.helper.notes, json(path.join(D.heardB, it.source.id + '.json')).notes.length);
    assert.ok(it.heard.helper.notes > it.heard.browser.notes, 'the synthetic helper holds more notes');
    assert.equal(it.heard.helper.summary.uncertain > 0, true, 'the helper summary is in the key');
    assert.ok(it.agreement && Array.isArray(it.agreement.flags) && 'alignedShare' in it.agreement);
    assert.deepEqual(it.parts, it.arranged.browser && it.arranged.helper ? ['T', 'A'] : ['T'], 'part A only when the arranger accepts BOTH readings');
  });
  assert.ok(path.relative(A.outDir, A.keyDir).startsWith('..') && path.relative(A.keyDir, A.outDir).startsWith('..'));
});

test('the window of seconds is chosen from the BROWSER notes and both readings show the bars that cover it; what is drawn is what each Score holds', () => {
  Object.keys(key.items).forEach(id => {
    const it = key.items[id], ex = it.excerpt;
    const browserNotes = heardOf(it.source.id).notes;
    const w = EX.chooseWindow(browserNotes, { seconds: ex.seconds });
    assert.equal(ex.start, w.start, id + ': the start is the one the browser notes give'); assert.equal(ex.end, w.end);
    assert.match(it.excerpt.how, /sounding|most sound/);
    ['browser', 'helper'].forEach(a => {
      const arm = it.arms[a];
      ['T', 'A'].forEach(p => {
        const c = arm.counts[p];
        if (p === 'A' && !it.parts.includes('A')) return;
        assert.ok(c, id + ' ' + a + ' ' + p + ' is drawn');
        ['wide', 'narrow'].forEach(l => { assert.equal(c[l].heads, c.score.heads, id + ' ' + a + ' ' + p + ' ' + l + ' heads'); assert.equal(c[l].rests, c.score.rests, id + ' ' + a + ' ' + p + ' ' + l + ' rests'); });
        assert.equal(c.struck, c.score.heads - c.score.tieStops);
      });
      assert.ok(arm.covers[0] <= ex.start + 1e-6 && arm.covers[1] >= ex.end - 1e-6, id + ' ' + a + ' covers the window');
      assert.equal(ex.arms[a].count, arm.barsShown);
    });
    const w2 = ['browser', 'helper'].map(a => it.arms[a].covers), bar = Math.max(ex.barSeconds * 2, 6);
    assert.ok(Math.abs(w2[0][0] - w2[1][0]) < bar && Math.abs(w2[0][1] - w2[1][1]) < bar, id + ' both readings show about the same seconds: ' + JSON.stringify(w2));
  });
});

test('determinism: the same seed and notes give byte-identical files whatever order the pieces are listed in; another seed changes sides or order; a short seed is refused', async () => {
  /* the same notes in folders whose items.json lists the pieces the other way round */
  const dir2 = tmpDir('revd'), dirB2 = tmpDir('revb'), reversed = JSON.stringify(json(path.join(D.heard, 'items.json')).slice().reverse());
  NAMES.forEach(n => { fs.copyFileSync(path.join(D.heard, n + '.json'), path.join(dir2, n + '.json')); fs.copyFileSync(path.join(D.heardB, n + '.json'), path.join(dirB2, n + '.json')); });
  fs.writeFileSync(path.join(dir2, 'items.json'), reversed); fs.writeFileSync(path.join(dirB2, 'items.json'), reversed);
  const b = await build({ heard: dir2, heardB: dirB2 }, { results: built }, 'b');
  const ra = readAll(A.outDir), rb = readAll(b.outDir);
  Object.keys(ra).forEach(f => assert.ok(ra[f].equals(rb[f]), f + ' differs when the item order differs'));
  const strip = k => { const o = JSON.parse(JSON.stringify(k)); delete o.inputs.buildSeconds; Object.values(o.items).forEach(i => ['browser', 'helper'].forEach(a => { if (i.arms[a].arrange) i.arms[a].arrange.ms = 0; })); return JSON.stringify(o); };
  assert.equal(strip(key), strip(json(b.files.key)));
  const c = await build(D, { results: built, seed: 'g10b0-another-secret-seed-9876543210' }, 'c');
  const sig = k => Object.keys(k.items).map(id => id + ':' + k.items[id].source.id + ':' + k.items[id].X).join('|');
  assert.notEqual(sig(key), sig(json(c.files.key))); assert.notEqual(A.packetId, c.packetId);
  await assert.rejects(build(D, { results: built, seed: 'short' }, 'd'), /at least 20/);
  const r = await build(D, { results: built, seed: undefined }, 'e');
  assert.match(json(r.files.key).seed, /^[0-9a-f]{32}$/);
  assert.ok(fs.readFileSync(r.files.html, 'utf8').indexOf(json(r.files.key).seed) < 0);
  /* the version comparison of the same pieces is another packet */
  assert.notEqual(A.packetId, (await buildPacket({ mode: 'h10', seed: SEED, heard: D.heard, out: path.join(tmpDir('ver'), 'p'), keyOut: path.join(tmpDir('verk'), 'k'), jobs: 1 })).packetId);
});

/* ---- the vocabulary ---- */
test('leak scan: no word of the sources (browser, helper, engine, TransKun, Kong, ensemble, local ...) and no version stamp or seed in the page, the manifest or any drawing; the page\'s own localStorage and save state are not leaks', () => {
  const drawings = PAGE.drawingsOf(html);
  assert.equal(Object.keys(drawings).length, Object.values(key.items).reduce((a, it) => a + it.parts.length * 2, 0), 'every part of every piece, X and Y');
  assert.deepEqual(leakScan(html, manifestText, drawings, SEED, { engine: true }), []);
  assert.deepEqual(LEAK.scanEngine(html, manifestText, drawings, { seed: SEED, credit: PAGE.CREDIT, titles: [] }), [], 'the builder\'s own scan agrees');
  assert.ok(/localStorage/.test(html) && /'local'/.test(html), 'the page does use them');
  /* the key is where those words live */
  const k = JSON.stringify(key);
  ['browser', 'helper', 'TransKun', 'Kong'].forEach(w => assert.ok(k.indexOf(w) > 0, w + ' is in the key'));
});

test('mutation: a word of the sources planted in the introduction, a class, an id, a drawing, the shared fragments, the manifest or a Korean word is caught by both scans', () => {
  const drawings = PAGE.drawingsOf(html);
  const clone = d => JSON.parse(JSON.stringify(d));
  const planted = {
    'browser in the introduction': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (browser)</h2>'), manifestText, drawings],
    'the Korean word for browser': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (브라우저)</h2>'), manifestText, drawings],
    'helper in a class': () => [html.replace('<div class="side" data-side="X">', '<div class="side helper-arm" data-side="X">'), manifestText, drawings],
    'engine in an id': () => [html.replace('id="sec-i01-T"', 'id="sec-i01-T-engine"'), manifestText, drawings],
    'TransKun in a drawing attribute': () => { const d = clone(drawings); d.i01tX[0] = d.i01tX[0].replace('<g class="ppp-system">', '<g class="ppp-system" data-src="TransKun">'); return [html, manifestText, d]; },
    'a Kong in a narrow drawing': () => { const d = clone(drawings); d.i02tY[1] = d.i02tY[1].replace(/<svg /, '<svg id="kong" '); return [html, manifestText, d]; },
    'ensemble in a script comment': () => [html.replace('(function(){', '(function(){ /* ensemble */'), manifestText, drawings],
    'the word local in the text': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (local)</h2>'), manifestText, drawings],
    'local as a class': () => [html.replace('<div class="side" data-side="X">', '<div class="side local" data-side="X">'), manifestText, drawings],
    'a model name in the manifest': () => [html, manifestText.replace('"label": "A"', '"label": "A", "model": "onsets and frames"'), drawings],
    'a title naming a source': () => [html, manifestText.replace('"title": "Piece nearer"', '"title": "Piece nearer (helper)"'), drawings],
    'a build stamp': () => [html.replace('검토 번호', 'build 3f2a9c1 검토 번호'), manifestText, drawings],
    'the seed in a comment': () => [html.replace('</body>', '<!-- ' + SEED + ' --></body>'), manifestText, drawings]
  };
  Object.keys(planted).forEach(name => {
    const [h, m, d] = planted[name]();
    assert.ok(h !== html || m !== manifestText || JSON.stringify(d) !== JSON.stringify(drawings), name + ': the mutation changed something');
    assert.ok(leakScan(h, m, d, SEED, { engine: true }).length > 0, name + ' was not caught by the test scan');
    assert.ok(LEAK.scanEngine(h, m, d, { seed: SEED, credit: PAGE.CREDIT, titles: [] }).length > 0, name + ' was not caught by the builder\'s scan');
  });
  /* a title is the piece's own: left out of the page scan (a real title may say "Hong Kong"), but the Lead is warned */
  const t = LEAK.scanEngine(html.replace('Piece nearer', 'Hong Kong nearer'), manifestText.replace('Piece nearer', 'Hong Kong nearer'), drawings, { seed: SEED, credit: PAGE.CREDIT, titles: ['Hong Kong nearer'] });
  assert.deepEqual(t, []);
  assert.deepEqual(LEAK.titleWarnings(['Hong Kong nearer', 'Local Hero', 'Clair de lune (classical)']).map(w => w.replace(/^title ".*?" /, '')), ['contains "kong"', 'contains the word "local"']);
});

test('the builder refuses to write a packet that would give the sources away (a link that says "helper"), and warns about a title that does; neither is done silently', async () => {
  const d2 = heardDirs(['know'], { know: { url: 'https://www.youtube.com/watch?v=helperxxxxx' } });
  const r = { know: built.know };
  await assert.rejects(build(d2, { results: r, seed: SEED }, 'leak'), /would give the sources away.*helper/);
  const d3 = heardDirs(['know'], { know: { title: 'Hong Kong Phooey (local cover)' } });
  const logs = [];
  const ok = await build(d3, { results: r, log: m => logs.push(m) }, 'warn');
  assert.ok(ok.warnings.length >= 2 && ok.warnings.some(w => /kong/.test(w)) && ok.warnings.some(w => /local/.test(w)));
  assert.ok(logs.some(l => /WARNING title .*kong/.test(l)));
  assert.deepEqual(json(ok.files.key).inputs.warnings, ok.warnings);
  assert.ok(fs.readFileSync(ok.files.html, 'utf8').indexOf('Hong Kong Phooey') > 0, 'the title is on the page (the Lead decides)');
  const nt = await build(d3, { results: r, titles: false }, 'notitle');
  assert.equal(nt.warnings.length, 0); assert.ok(fs.readFileSync(nt.files.html, 'utf8').indexOf('Hong Kong') < 0);
});

/* ---- inputs ---- */
test('options: --compare engine needs --heard-b, --heard-b is only for it, an unknown comparison and the other modes are refused before any work', async () => {
  const base = { mode: 'h10', seed: SEED, heard: D.heard, out: path.join(tmpDir('o1'), 'p'), keyOut: path.join(tmpDir('o1k'), 'k'), jobs: 1 };
  await assert.rejects(buildPacket(Object.assign({}, base, { compare: 'engine' })), /--heard-b <dir> is required/);
  await assert.rejects(buildPacket(Object.assign({}, base, { heardB: D.heardB })), /only for --compare engine/);
  await assert.rejects(buildPacket(Object.assign({}, base, { compare: 'speed' })), /--compare must be 'engine'/);
  await assert.rejects(buildPacket(Object.assign({}, base, { mode: 'h9', compare: 'engine', heardB: D.heardB })), /for --mode h10/);
  await assert.rejects(buildPacket(Object.assign({}, base, { compare: 'engine', heardB: path.join(D.heardB, 'nowhere') })), /is not a folder/);
  await assert.rejects(buildPacket(Object.assign({}, base, { compare: 'engine', heardB: D.heardB, out: path.join(REPO, 'zz-engine-out') })), /inside the repository/);
  assert.equal(fs.existsSync(path.join(REPO, 'zz-engine-out')), false);
});

test('a piece with no helper notes, an unusable helper file, helper notes of other audio, or a piece only the helper folder has is reported with its reason in the key and on the console, never dropped silently', async () => {
  const d = heardDirs(['know', 'nearer', 'notone', 'gather']);
  fs.rmSync(path.join(d.heardB, 'nearer.json'));
  fs.writeFileSync(path.join(d.heardB, 'notone.json'), '{"notes": []}');
  const g = json(path.join(d.heardB, 'gather.json')); g.duration = g.duration + 30; fs.writeFileSync(path.join(d.heardB, 'gather.json'), JSON.stringify(g));
  fs.writeFileSync(path.join(d.heardB, 'items.json'), JSON.stringify([{ id: 'know' }, { id: 'stray' }]));
  fs.writeFileSync(path.join(d.heardB, 'stray.json'), fs.readFileSync(path.join(d.heardB, 'know.json')));
  const logs = [];
  const r = await build(d, { results: built, log: m => logs.push(m) }, 'skip');
  assert.equal(r.count, 1, 'only know is built');
  const sk = json(r.files.key).inputs.skipped, by = id => sk.find(s => s.id === id);
  assert.deepEqual(sk.map(s => s.id).sort(), ['gather', 'nearer', 'notone', 'stray']);
  assert.match(by('nearer').reason, /no helper notes/); assert.match(by('notone').reason, /not heard notes/); assert.match(by('gather').reason, /not the same audio/); assert.match(by('stray').reason, /not in --heard/);
  ['nearer', 'notone', 'gather', 'stray'].forEach(id => assert.ok(logs.some(l => l.indexOf('SKIPPED ' + id) === 0), id + ' is on the console'));
  /* nothing to compare at all is an error */
  const none = heardDirs(['know']); fs.rmSync(path.join(none.heardB, 'know.json'));
  await assert.rejects(build(none, { results: built }, 'none'), /no item could be built/);
});

test('when both folders hold the same notes the readings agree everywhere: the packet is built, the key says both sides are drawn identically, and no disagreement is flagged', async () => {
  const d = heardDirs(['know']);
  fs.writeFileSync(path.join(d.heardB, 'know.json'), fs.readFileSync(path.join(d.heard, 'know.json')));
  const logs = [];
  const r = await build(d, { log: m => logs.push(m) }, 'same');
  const k = json(r.files.key).items.i01;
  assert.deepEqual(k.identicalSides, { T: true, A: k.parts.includes('A') });
  assert.deepEqual(k.agreement.flags, []); assert.equal(k.agreement.alignedShare, 1);
  assert.ok(logs.some(l => /drawn identically/.test(l)));
  assert.ok(!logs.some(l => /DISAGREE/.test(l)));
});

test('a reading the page threw away (its plausibility check) is kept, written by the classic conversion, and said in the key and on the console', async () => {
  const jobs = jobsOf(D, ['know']);
  const b = await PACKET.buildItems(jobs, { jobs: 1 });
  b.know.result.arms.helper.key.v2Rejected = true; b.know.result.arms.helper.key.wroteV2 = false;
  const logs = [], dk = heardDirs(['know']);
  const r = await build(dk, { results: b, log: m => logs.push(m) }, 'rej');
  assert.equal(json(r.files.key).items.i01.arms.helper.v2Rejected, true);
  assert.ok(logs.some(l => /threw the v2 result of the helper notes away/.test(l)));
  const s = decode(json(r.files.key), { format: 'ppp-review-ratings/2', mode: 'h10', packetId: r.packetId, items: [] });
  assert.deepEqual(s.arrangerOutcome.v2ThrownAway, { browser: [], helper: ['i01'] });
});

/* ---- decode ---- */
const sideFor = (it, arm) => (it.X === arm ? 'X' : 'Y');
const sideRating = (pass, tags, text) => ({ pass: pass, tags: tags || [], text: text || '' });
function answersFrom(k, f) {
  return { format: 'ppp-review-ratings/2', mode: 'h10', packetId: k.packetId, reviewer: 'piano teacher', exportedAt: 'x',
    items: Object.keys(k.items).map(id => { const o = { id: id }; k.items[id].parts.forEach(p => { o[p] = f(k.items[id], p, id); }); return o; }) };
}

test('decode: a fake set of answers gives the per-source counts the key says (preference, pass, tags, per part, per piece, visible differences, arranger outcome)', () => {
  /* the teacher prefers the helper on part T of the first piece and the browser on the other two; the helper's score fails on missing/extra notes where it loses; part A: similar */
  const ans = answersFrom(key, (it, p, id) => {
    const o = { preference: null, X: sideRating(null), Y: sideRating(null) };
    if (p === 'T') {
      const win = id === 'i01' ? 'helper' : 'browser', lose = win === 'helper' ? 'browser' : 'helper';
      o.preference = sideFor(it, win); o[sideFor(it, win)] = sideRating(true); o[sideFor(it, lose)] = sideRating(false, lose === 'helper' ? ['missing-extra', 'rests'] : ['durations'], 'lost ' + id);
    } else { o.preference = 'same'; o.X = sideRating(true); o.Y = sideRating(true); }
    return o;
  });
  const s = decode(key, ans);
  assert.equal(s.compare, 'engine'); assert.equal(s.pieces, 3);
  assert.deepEqual([s.byPart.T.preference.browser, s.byPart.T.preference.helper, s.byPart.T.preference.similar, s.byPart.T.preference.unrated], [2, 1, 0, 0]);
  assert.equal(s.byPart.T.preference.decisive, 3); assert.equal(s.byPart.T.preference.helperShareOfDecisive, 0.333);
  const nA = Object.values(key.items).filter(it => it.parts.includes('A')).length;
  assert.equal(s.byPart.A ? s.byPart.A.preference.similar : 0, nA);
  assert.equal(s.overall.preference.helper, 1); assert.equal(s.overall.preference.browser, 2); assert.equal(s.overall.preference.similar, nA);
  assert.deepEqual([s.byPart.T.pass.helper.pass, s.byPart.T.pass.helper.fail, s.byPart.T.pass.browser.pass, s.byPart.T.pass.browser.fail], [1, 2, 2, 1]);
  assert.deepEqual(s.byPart.T.tags.helper, { 'missing-extra': 2, rests: 2 }); assert.deepEqual(s.byPart.T.tags.browser, { durations: 1 });
  assert.equal(s.byPart.T.notes.helper.length, 2); assert.equal(s.byPart.T.notes.browser.length, 1);
  assert.equal(s.perPiece.length, 3); assert.equal(s.perPiece[0].parts.T.preference, 'helper'); assert.equal(s.perPiece[0].xIs, key.items.i01.X);
  assert.equal(s.perPiece[0].heardNotes.helper, key.items.i01.heard.helper.notes);
  assert.ok(s.perPiece[0].piece.browser.bars > 0 && s.perPiece[0].piece.helper.metre);
  assert.equal(s.arrangerOutcome.bothArranged.length, nA);
  assert.equal(s.visible[0].part, 'T'); assert.equal(s.visible[0].pieces, 3);
  assert.equal(s.visible[0].heads.helperMore + s.visible[0].heads.helperFewer + s.visible[0].heads.same, 3);
  assert.ok(s.heardNotesRatio.mean > 1, 'the helper holds more notes');
  assert.deepEqual(Object.keys(s.byAgreement.T), ['agreeing', 'disagreeing']);
  assert.equal(s.byAgreement.T.agreeing.parts + s.byAgreement.T.disagreeing.parts, 3);
  const text = report(s);
  assert.match(text, /engine comparison/); assert.match(text, /Part T \(the transcription\)/); assert.match(text, /helper share of decisive 33%/); assert.match(text, /Caveats:/); assert.match(text, /Blinding is partial/);
  assert.match(text, /Visible in the drawings, part T/); assert.match(text, /heard notes \d+ \/ \d+/);
});

test('decode: the same answers with X and Y swapped in the key give the swapped result (the key is what makes the count right)', () => {
  const swapped = JSON.parse(JSON.stringify(key));
  Object.values(swapped.items).forEach(it => { const x = it.X; it.X = it.Y; it.Y = x; });
  const ans = answersFrom(key, () => ({ preference: 'X', X: sideRating(false), Y: sideRating(true) }));   /* X always fails, Y always passes */
  const a = decode(key, ans), b = decode(swapped, ans);
  const xh = Object.keys(key.items).filter(id => key.items[id].X === 'helper').length;
  assert.equal(a.byPart.T.preference.helper, xh); assert.equal(b.byPart.T.preference.helper, 3 - xh); assert.equal(b.byPart.T.preference.browser, xh);
  assert.equal(a.byPart.T.pass.helper.fail, xh); assert.equal(b.byPart.T.pass.helper.fail, 3 - xh);
});

test('decode: refuses what is not this packet, a rating for an unknown piece, a piece rated twice, an invalid preference; unanswered parts are counted as unanswered; a key without sides is refused', () => {
  const ok = answersFrom(key, () => ({ preference: null, X: sideRating(null), Y: sideRating(null) }));
  const s = decode(key, ok);
  assert.equal(s.overall.preference.unrated, s.overall.parts); assert.equal(s.overall.pass.helper.unrated, s.overall.parts); assert.equal(s.answered.pieces, 3);
  assert.throws(() => decode(key, Object.assign({}, ok, { packetId: 'other' })), /packet/);
  assert.throws(() => decode(key, Object.assign({}, ok, { mode: 'h9' })), /ratings file/);
  assert.throws(() => decode(key, Object.assign({}, ok, { items: ok.items.concat([{ id: 'i99' }]) })), /does not have/);
  assert.throws(() => decode(key, Object.assign({}, ok, { items: ok.items.concat([ok.items[0]]) })), /twice/);
  const bad = JSON.parse(JSON.stringify(ok)); bad.items[0].T.preference = 'Z';
  assert.throws(() => decode(key, bad), /invalid preference/);
  const noSides = JSON.parse(JSON.stringify(key)); noSides.items.i01.X = 'v2';
  assert.throws(() => decode(noSides, ok), /no browser\/helper sides/);
  /* a version-comparison key is still decoded as before */
  assert.throws(() => require(path.join(REPO, 'review/h10/decode-engine.js')).decodeEngine(Object.assign({}, key, { compare: undefined }), ok), /not an engine-comparison review key/);
});

test('the command line: decode --mode h10 --compare engine prints the report; --compare engine on another key, and an unknown comparison, are refused; an engine key without the flag decodes as one; the database rows read the same', () => {
  const dir = tmpDir('engcli');
  const ans = answersFrom(key, (it) => ({ preference: sideFor(it, 'helper'), X: sideRating(true), Y: sideRating(false, ['missing-extra']) }));
  fs.writeFileSync(path.join(dir, 'ratings.json'), JSON.stringify(ans));
  const run = args => spawnSync(process.execPath, [path.join(REPO, 'review/decode.js')].concat(args), { encoding: 'utf8' });
  const r = run(['--mode', 'h10', '--compare', 'engine', '--key', A.files.key, '--ratings', path.join(dir, 'ratings.json'), '--out', path.join(dir, 'summary.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /engine comparison.*3 pieces/);
  assert.equal(json(path.join(dir, 'summary.json')).compare, 'engine');
  const noFlag = run(['--mode', 'h10', '--key', A.files.key, '--ratings', path.join(dir, 'ratings.json')]);
  assert.equal(noFlag.status, 0); assert.equal(noFlag.stdout, r.stdout); assert.match(noFlag.stderr, /decoded as one/);
  assert.notEqual(run(['--compare', 'speed', '--key', A.files.key, '--ratings', path.join(dir, 'ratings.json')]).status, 0);
  const plain = path.join(dir, 'plain-key.json'); const pk = JSON.parse(JSON.stringify(key)); delete pk.compare; fs.writeFileSync(plain, JSON.stringify(pk));
  const bad = run(['--mode', 'h10', '--compare', 'engine', '--key', plain, '--ratings', path.join(dir, 'ratings.json')]);
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /not an engine-comparison key/);
  /* rows from the artifact database */
  const { dbToRatings } = require(path.join(REPO, 'review/h10/db-to-ratings.js'));
  const rows = ans.items.map(it => ({ path: 'answers/' + key.packetId + '/items/' + it.id, data: Object.assign({ id: it.id, packetId: key.packetId, t: 5, v: 1 }, ...['T', 'A'].filter(x => it[x]).map(x => ({ [x]: { pref: it[x].preference, X: it[x].X, Y: it[x].Y } }))) }));
  const norm = o => JSON.stringify(Object.assign({}, o, { reviewer: null }));
  assert.equal(norm(decode(key, dbToRatings(rows, key.packetId))), norm(decode(key, ans)));
});

test('the command line of the builder: --compare engine builds, prints the disagreement summary, --list shows both note counts, a bad --compare is refused', () => {
  const d = heardDirs(['know']);
  const out = path.join(tmpDir('clib'), 'p'), keyOut = path.join(tmpDir('clibk'), 'k');
  const run = args => spawnSync(process.execPath, [path.join(REPO, 'review/build.js')].concat(args), { encoding: 'utf8' });
  const r = run(['--mode', 'h10', '--compare', 'engine', '--heard', d.heard, '--heard-b', d.heardB, '--out', out, '--key-out', keyOut, '--seed', SEED, '--jobs', '1']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /packet: .*index\.html \(\d+\.\d+ MB\), 1 items/); assert.match(r.stdout, /engine comparison: the two readings disagree on bars, tempo or metre in \d of 1 pieces/);
  assert.equal(json(path.join(keyOut, 'key.json')).compare, 'engine');
  const l = run(['--mode', 'h10', '--compare', 'engine', '--heard', d.heard, '--heard-b', d.heardB, '--list']);
  assert.match(l.stdout, /know \d+ heard notes, \d+ helper notes/);
  assert.notEqual(run(['--mode', 'h10', '--compare', 'speed', '--heard', d.heard, '--heard-b', d.heardB, '--out', out + '2', '--key-out', keyOut + '2']).status, 0);
  assert.notEqual(run(['--mode', 'h9', '--compare', 'engine', '--heard-b', d.heardB, '--out', out + '3', '--key-out', keyOut + '3']).status, 0);
  assert.match(run(['--help']).stdout, /--compare engine/);
});
