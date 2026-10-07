/* H-10c: the blind check of the NOTES of the Song Arranger's copies of recordings - the lead sheet against the reduction (`--compare arrange`). Pure and Node-only (the page in a
   browser is tests/review/h10-arrange-page.test.js). Synthetic input only: heard-notes fixtures (real Onsets & Frames runs on rendered public-domain hymns, tests/bench/replay-of);
   nothing of the user's covers is in the repository. A piece the reduction refuses and a piece the lead sheet refuses are made with a stub in front of the page's own arranger.
   Covered: the item (four copies, one window, what counts as made, the refusals), the parts (pairs, singles, the merge of equal levels), the packet (files, sides, balance, the key and
   the pass rule fixed in it), the vocabulary scan and its mutations (lead sheet, the composer line's suffix, the relaxed note, reduce, the Korean words), and the decode of fake
   answers (PASS, FAIL on each rule, INCOMPLETE, the thresholds read from the key, the database rows). */
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, heardDir, heardOf, tmpDir, LEAK } = require('./h10-helpers.js');
const { readAll } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const { decode, report } = require(path.join(REPO, 'review/decode.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-arrange.js'));
const PACKET = require(path.join(REPO, 'review/h10/packet.js'));
const ARR = require(path.join(REPO, 'review/h10/packet-arrange.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));
const APP = require(path.join(REPO, 'review/lib/appcode.js'));
const BLIND = require(path.join(REPO, 'review/lib/blind.js'));
const DB = require(path.join(REPO, 'review/h10/db-to-ratings.js'));

const SEED = 'h10c-test-secret-seed-0123456789';
/* nearer, gather, fount: both methods make copies (pairs); know: the reduction refuses (a single, the lead sheet's); notone: the lead sheet refuses and the page falls back (a single, the reduction's) */
const NAMES = ['nearer', 'know', 'notone', 'gather', 'fount'];
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const real = APP.arranger();
const refusing = which => ({ arrange: async (g, level, title, o) => {
  if (which === 'reduce' && o.recordingArrange === 'reduce') return { ok: false, reason: 'UNREACHABLE' };
  if (which === 'leadsheet' && o.recordingArrange === 'leadsheet') {
    const red = await real.arrange(g, level, title, { recordingArrange: 'reduce' });   /* the page's fallback: the reduction's copy, with the lead sheet's reason */
    return Object.assign({}, red, { recordingArrange: 'reduce', leadsheetRefusal: 'LEADSHEET_NO_MELODY' });
  }
  return real.arrange(g, level, title, o);
} });
const jobOf = n => ({ id: n, title: 'Piece ' + n, heard: heardOf(n), compare: 'arrange', levels: ITEM.ARRANGE_LEVELS, excerpt: {} });

const build = (extra, tag) => buildPacket(Object.assign({ mode: 'h10', compare: 'arrange', seed: SEED, heard: D, results: built, out: path.join(tmpDir('arr' + (tag || '')), 'packet'), keyOut: path.join(tmpDir('arrk' + (tag || '')), 'key'), jobs: 1 }, extra || {}));

let D, built, A, html, manifestText, key;
before(async () => {
  D = heardDir(NAMES);
  built = {};
  for (const n of NAMES) built[n] = { ok: true, result: await ITEM.buildArrangeItem(jobOf(n), { arranger: n === 'know' ? refusing('reduce') : n === 'notone' ? refusing('leadsheet') : real }) };
  A = await build({}, 'a');
  html = fs.readFileSync(A.files.html, 'utf8');
  manifestText = fs.readFileSync(A.files.manifest, 'utf8');
  key = json(A.files.key);
});

/* ---- the item ---- */
test('an item: the page\'s v2 conversion read once, four copies (beginner and intermediate, each made with the lead sheet and with the reduction), one window of bars for all of them', () => {
  const r = built.nearer.result;
  assert.deepEqual(Object.keys(r.levels), ['beginner', 'intermediate']);
  const win = r.conversion.window;
  assert.ok(win[1] - win[0] + 1 >= 8 && win[1] - win[0] + 1 <= 16, 'about twelve bars: ' + (win[1] - win[0] + 1));
  assert.equal(r.conversion.wroteV2, true); assert.equal(r.conversion.v2Rejected, false);
  ['beginner', 'intermediate'].forEach(l => ['leadsheet', 'reduce'].forEach(m => {
    const c = r.levels[l][m];
    assert.equal(c.made, true, l + ' ' + m); assert.ok(c.part, 'drawn');
    assert.deepEqual(c.part.window, win, l + ' ' + m + ' shows the conversion\'s window');
    assert.equal(c.key.madeBy, m, 'the lead sheet was asked for and made it / the reduction made the other');
    assert.equal(c.key.asked, m);
    assert.equal(c.part.counts.wide.heads, c.part.counts.score.heads, 'what is drawn is what the Score holds');
    assert.equal(c.part.counts.narrow.rests, c.part.counts.score.rests);
    assert.equal(c.key.leadsheetRefusal, null);
    assert.equal(typeof c.key.ms, 'number');
  }));
  assert.ok(r.levels.beginner.leadsheet.key.leadsheet && r.levels.beginner.leadsheet.key.leadsheet.melodyNotes > 0, 'the lead sheet\'s own counts are in the key');
  assert.equal(r.levels.beginner.reduce.key.leadsheet, null);
});

test('what counts as made: a refusal of the reduction is a refusal; a lead sheet that refused and fell back to the reduction made NOTHING (its reason is kept) and the reduction\'s own copy stands', () => {
  const k = built.know.result.levels, n = built.notone.result.levels;
  ['beginner', 'intermediate'].forEach(l => {
    assert.equal(k[l].reduce.made, false); assert.equal(k[l].reduce.key.reason, 'UNREACHABLE'); assert.equal(k[l].reduce.part, null); assert.equal(k[l].leadsheet.made, true);
    assert.equal(n[l].leadsheet.made, false, 'asked for the lead sheet, given the reduction');
    assert.equal(n[l].leadsheet.key.answered, true); assert.equal(n[l].leadsheet.key.madeBy, 'reduce'); assert.equal(n[l].leadsheet.key.leadsheetRefusal, 'LEADSHEET_NO_MELODY'); assert.equal(n[l].leadsheet.part, null);
    assert.equal(n[l].reduce.made, true);
  });
});

test('a copy with another number of bars than the conversion is not drawn (said in the key), and a thrown arranger is a refusal, not a crash', async () => {
  const short = { arrange: async (g, level, title, o) => { const x = await real.arrange(g, level, title, o); if (!x.ok || o.recordingArrange !== 'reduce') return x; return Object.assign({}, x, { graph: Object.assign({}, x.graph, { timeline: Object.assign({}, x.graph.timeline, { measures: x.graph.timeline.measures.slice(0, -1) }) }) }); } };
  const r = await ITEM.buildArrangeItem(jobOf('fount'), { arranger: short });
  assert.equal(r.levels.beginner.reduce.made, false); assert.match(r.levels.beginner.reduce.key.problem, /bars, the conversion/); assert.equal(r.levels.beginner.reduce.part, null);
  assert.equal(r.levels.beginner.leadsheet.made, true);
  const boom = await ITEM.buildArrangeItem(jobOf('fount'), { arranger: { arrange: async () => { throw new Error('boom'); } } });
  assert.equal(boom.levels.beginner.leadsheet.made, false); assert.equal(boom.levels.beginner.leadsheet.key.reason, 'THROWN'); assert.match(boom.levels.beginner.leadsheet.key.message, /boom/);
});

/* ---- the parts ---- */
const fakeCopy = (notes, heads) => ({ svg: '<svg viewBox="0 0 1 1"/>', svgNarrow: '<svg viewBox="0 0 1 1"/>', notes: notes, seconds: 1, bars: 1, counts: { score: { heads: heads || notes.length, rests: 0 }, wide: {}, narrow: {} } });
const cell = (made, part) => ({ made: made, part: part, key: {} });
test('partsOf: a pair where both methods made a copy, a single where one did, nothing where neither did; equal copies at both levels are ONE part (merged); a level that differs is its own part', () => {
  const a = fakeCopy([[0, 1, 60, 80]]), b = fakeCopy([[0, 1, 62, 80]]), c = fakeCopy([[0, 1, 64, 80]]);
  const lv = (lead, red) => ({ leadsheet: cell(!!lead, lead), reduce: cell(!!red, red) });
  const both = ARR.partsOf({ levels: { beginner: lv(a, b), intermediate: lv(a, b) } });
  assert.deepEqual(both.map(p => [p.key, p.kind, p.merged, p.title]), [['BI', 'pair', true, '초급 · 중급']]);
  const split = ARR.partsOf({ levels: { beginner: lv(a, b), intermediate: lv(c, b) } });
  assert.deepEqual(split.map(p => [p.key, p.kind, p.merged, p.title]), [['B', 'pair', false, '초급'], ['I', 'pair', false, '중급']]);
  const single = ARR.partsOf({ levels: { beginner: lv(a, null), intermediate: lv(a, null) } });
  assert.deepEqual(single.map(p => [p.key, p.kind]), [['BI', 'single']]);
  const mixed = ARR.partsOf({ levels: { beginner: lv(a, b), intermediate: lv(a, null) } });
  assert.deepEqual(mixed.map(p => [p.key, p.kind]), [['B', 'pair'], ['I', 'single']], 'a method that made a copy at one level only: not the same at both');
  assert.deepEqual(ARR.partsOf({ levels: { beginner: lv(null, null), intermediate: lv(a, null) } }).map(p => [p.key, p.kind]), [['I', 'single']]);
  assert.deepEqual(ARR.partsOf({ levels: { beginner: lv(null, null), intermediate: lv(null, null) } }), []);
  assert.deepEqual(ARR.partsOf({ levels: { beginner: lv(a, b), intermediate: lv(c, b) } }, ['beginner']).map(p => p.key), ['B'], 'one level asked for');
  /* the same sounding notes are one copy even when the drawing differs (fingering) */
  const a2 = Object.assign({}, a, { svg: '<svg viewBox="0 0 1 1"><g/></svg>' });
  assert.equal(ARR.partsOf({ levels: { beginner: lv(a, b), intermediate: lv(a2, b) } })[0].key, 'BI');
});

/* ---- the packet ---- */
test('the packet is two files; the page shows what each piece has: pairs where both methods made a copy, singles where one did; the manifest names no method', () => {
  assert.deepEqual(Object.keys(readAll(A.outDir)), ['index.html', 'manifest.json']);
  const m = json(A.files.manifest);
  assert.equal(m.review, 'H-10c'); assert.equal(m.compare, 'arrange'); assert.equal(m.items.length, 5);
  assert.equal(m.items.map(i => i.id).join(','), 'i01,i02,i03,i04,i05');
  const bySource = id => key.items[Object.keys(key.items).find(i => key.items[i].source.id === id)];
  ['nearer', 'gather', 'fount'].forEach(n => { const it = bySource(n); assert.ok(Object.values(it.parts).every(p => p.kind === 'pair'), n + ' is shown as pairs'); });
  ['know', 'notone'].forEach(n => { const it = bySource(n); assert.ok(Object.values(it.parts).every(p => p.kind === 'single'), n + ' is shown alone'); });
  assert.equal(bySource('know').parts[Object.keys(bySource('know').parts)[0]].S, 'leadsheet');
  assert.equal(bySource('notone').parts[Object.keys(bySource('notone').parts)[0]].S, 'reduce');
  m.items.forEach(it => it.parts.forEach(p => { assert.ok(['pair', 'single'].includes(p.kind)); assert.deepEqual(p.versions, p.kind === 'pair' ? [{ label: 'X' }, { label: 'Y' }] : [{ label: 'S' }]); }));
  assert.match(A.packetId, /^[0-9a-f]{12}$/);
  assert.ok(html.indexOf('H-10c 악보 확인') > 0);
  assert.ok(html.indexOf('음(멜로디)이 원곡과 맞나요?') > 0 && html.indexOf('학생에게 줄 수 있나요?') > 0 && html.indexOf('어느 쪽이 나아요?') > 0);
  ['맞아요', '대체로 맞아요', '틀린 곳이 많아요', '그대로', '조금 고치면', '안 돼요', '비슷해요'].forEach(w => assert.ok(html.indexOf('>' + w + '<') > 0, w));
  /* the single parts have one Play and no X / Y labels; the pairs have two and a preference row */
  const singles = (html.match(/data-play="S"/g) || []).length, pairs = (html.match(/data-play="X"/g) || []).length;
  assert.equal(singles, key.shown.singles); assert.equal(pairs, key.shown.pairs); assert.equal((html.match(/data-play="Y"/g) || []).length, pairs);
  assert.equal((html.match(/<button[^>]*data-act="pref"/g) || []).length, 3 * key.shown.pairs);
});

test('the key: seed, sides, what each copy was made by, every refusal and its reason, the facts of the conversion, and the pass rule fixed in it before any answer exists', () => {
  assert.equal(key.mode, 'h10'); assert.equal(key.compare, 'arrange'); assert.equal(key.seed, SEED); assert.equal(key.packetId, A.packetId); assert.ok(key.builtFrom);
  assert.deepEqual(Object.keys(key.arms), ['leadsheet', 'reduce']); assert.match(key.question, /lead-sheet copies accurate/);
  assert.deepEqual(key.passRule, ARR.PASS_RULE);
  assert.equal(key.passRule.leadNotesAccurateShare, 0.8); assert.equal(key.passRule.leadPreferredOrSimilarShare, 0.8); assert.equal(key.passRule.noPieceWhereOnlyLeadIsWrong, true);
  assert.match(key.passRule.accurate, /맞아요.*대체로 맞아요/);
  assert.ok(Object.isFrozen(ARR.PASS_RULE));
  assert.equal(key.shown.pieces, 5); assert.equal(key.shown.pairs + key.shown.singles, Object.values(key.items).reduce((n, it) => n + Object.keys(it.parts).length, 0));
  Object.keys(key.items).forEach(id => {
    const it = key.items[id];
    assert.ok(it.conversion.measures > 0 && it.conversion.tempo > 0 && /^\d+\/\d+$/.test(it.conversion.metre));
    assert.equal(it.heard.notes, heardOf(it.source.id).notes.length);
    Object.keys(it.parts).forEach(pk => {
      const p = it.parts[pk];
      if (p.kind === 'pair') { assert.equal(p.X, it.X); assert.equal(p.Y, it.Y); assert.ok([p.X, p.Y].sort().join() === 'leadsheet,reduce'); assert.equal(typeof p.identicalSides, 'boolean'); }
      else assert.ok(['leadsheet', 'reduce'].includes(p.S) && p.other !== p.S);
    });
    assert.equal(it.refusals.length, Object.values(it.levels).reduce((n, l) => n + Object.values(l).filter(c => !c.drawn).length, 0));
  });
  const know = Object.values(key.items).find(i => i.source.id === 'know'), notone = Object.values(key.items).find(i => i.source.id === 'notone');
  assert.ok(know.refusals.length === 2 && know.refusals.every(r => r.method === 'reduce' && r.reason === 'UNREACHABLE'));
  assert.ok(notone.refusals.length === 2 && notone.refusals.every(r => r.method === 'leadsheet' && r.leadsheetRefusal === 'LEADSHEET_NO_MELODY' && r.madeBy === 'reduce'));
  assert.deepEqual(key.summary.leadsheet.beginner, { made: 4, refused: 1, of: 5 }); assert.deepEqual(key.summary.reduce.beginner, { made: 4, refused: 1, of: 5 });
  assert.ok(path.relative(A.outDir, A.keyDir).startsWith('..') && path.relative(A.keyDir, A.outDir).startsWith('..'));
});

test('the sides: X is the lead sheet or the reduction by HMAC of the seed, an even split over the pieces that have a pair, the same sides for both levels; singles take their side from their own HMAC', () => {
  const pairs = Object.values(key.items).filter(i => Object.values(i.parts).some(p => p.kind === 'pair'));
  assert.equal(pairs.length, 3);
  const leadX = pairs.filter(i => i.X === 'leadsheet').length;
  assert.ok(leadX === 1 || leadX === 2, 'three pairs: two and one: ' + leadX);
  /* by the rule: rank by HMAC among the pairs, even rank = X is the lead sheet */
  const ranked = pairs.map(i => i.source.id).sort((a, b) => BLIND.hmac(SEED, 'xy|' + a) < BLIND.hmac(SEED, 'xy|' + b) ? -1 : 1);
  ranked.forEach((id, k) => assert.equal(pairs.find(i => i.source.id === id).X, k % 2 === 0 ? 'leadsheet' : 'reduce'));
  Object.values(key.items).forEach(i => Object.values(i.parts).filter(p => p.kind === 'pair').forEach(p => { assert.equal(p.X, i.X); assert.equal(p.Y, i.Y); }));
  /* the order of the pieces is the HMAC order */
  const order = Object.keys(key.items).map(id => key.items[id].source.id);
  assert.deepEqual(order, NAMES.slice().sort((a, b) => BLIND.hmac(SEED, 'order|' + a) < BLIND.hmac(SEED, 'order|' + b) ? -1 : 1));
});

test('assignArms with a balance predicate: the even split is made over the items it names and any other item takes its own HMAC parity; without it nothing changes', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, pair: i % 3 !== 0 }));
  const plain = BLIND.assignArms(items, SEED, 'a', 'b'), same = BLIND.assignArms(items, SEED, 'a', 'b', undefined);
  assert.deepEqual(plain, same);
  const bal = BLIND.assignArms(items, SEED, 'a', 'b', it => it.pair);
  const pairs = bal.filter(s => s.item.pair);
  assert.equal(pairs.length, 8); assert.equal(pairs.filter(s => s.x === 'a').length, 4, 'exactly half of the pairs');
  bal.filter(s => !s.item.pair).forEach(s => assert.equal(s.x, parseInt(BLIND.hmac(SEED, 'xy|' + s.key).slice(0, 2), 16) % 2 === 0 ? 'a' : 'b'));
  assert.deepEqual(bal.map(s => s.id + s.key), plain.map(s => s.id + s.key), 'the order and the ids are the same');
  assert.throws(() => BLIND.assignArms(items, 'short', 'a', 'b', it => it.pair), /at least 20/);
});

test('what is drawn is what each copy\'s Score holds, in both layouts, for every part and side; no side repeats a side of another piece', () => {
  Object.keys(key.items).forEach(id => Object.keys(key.items[id].parts).forEach(pk => {
    const p = key.items[id].parts[pk];
    const methods = p.kind === 'pair' ? [p.X, p.Y] : [p.S];
    methods.forEach(m => {
      const c = key.items[id].levels[p.levels[0]][m].counts;
      assert.ok(c.score.heads > 0, id + pk + m);
      ['wide', 'narrow'].forEach(l => { assert.equal(c[l].heads, c.score.heads); assert.equal(c[l].rests, c.score.rests); });
      assert.equal(c.struck, c.score.heads - c.score.tieStops);
    });
  }));
  const drawings = PAGE.drawingsOf(html);
  assert.equal(Object.keys(drawings).length, key.shown.pairs * 2 + key.shown.singles);
  /* a score may repeat within a piece (the reduction's copy is the same at both levels where the lead sheet's differs) but never across pieces */
  const owner = new Map();
  Object.keys(drawings).forEach(k => { const item = k.slice(0, 3), sg = drawings[k][0]; if (owner.has(sg)) assert.equal(owner.get(sg), item, k + ' repeats a score of another piece'); else owner.set(sg, item); });
  assert.ok(owner.size < Object.keys(drawings).length, 'the test does see a repeat inside a piece');
});

test('the window is chosen from the conversion: every copy of a piece shows the same bars, and the link and the line above the scores say the seconds of those bars', () => {
  Object.keys(key.items).forEach(id => {
    const it = key.items[id], ex = it.excerpt, cv = it.conversion;
    assert.ok((cv.window[0] === 0 || cv.covers[0] <= ex.start + 1e-6) && cv.covers[1] >= ex.end - 1e-6, id + ': the bars cover the window (a window that begins before the first bar starts with it)');
    assert.equal(ex.drawnFrom, cv.covers[0]); assert.equal(ex.drawnTo, cv.covers[1]);
    ['beginner', 'intermediate'].forEach(l => ['leadsheet', 'reduce'].forEach(m => { const c = it.levels[l][m]; if (c.drawn) assert.equal(c.counts.barsShown, cv.barsShown); }));
  });
  const m = html.match(/원곡 열기 \((\d+:\d\d)부터\)/g);
  assert.equal(m.length, 5);
  assert.ok(html.indexOf('https://www.youtube.com/watch?v=nearerxxxxx&amp;t=') > 0 || html.indexOf('watch?v=nearerxxxxx&amp;t=') > 0, 'the link opens at the first bar drawn');
});

test('determinism: the same seed and notes give byte-identical files whatever order the pieces are listed in; another seed changes the sides or the order; a short seed is refused', async () => {
  const dir2 = tmpDir('arrd'), reversed = JSON.stringify(json(path.join(D, 'items.json')).slice().reverse());
  NAMES.forEach(n => fs.copyFileSync(path.join(D, n + '.json'), path.join(dir2, n + '.json')));
  fs.writeFileSync(path.join(dir2, 'items.json'), reversed);
  const b = await build({ heard: dir2 }, 'b');
  const ra = readAll(A.outDir), rb = readAll(b.outDir);
  Object.keys(ra).forEach(f => assert.ok(ra[f].equals(rb[f]), f + ' differs when the item order differs'));
  const strip = k => { const o = JSON.parse(JSON.stringify(k)); delete o.inputs.buildSeconds; return JSON.stringify(o); };
  assert.equal(strip(key), strip(json(b.files.key)));
  const c = await build({ seed: 'h10c-another-secret-seed-9876543210' }, 'c');
  const sig = k => Object.keys(k.items).map(id => id + ':' + k.items[id].source.id + ':' + k.items[id].X).join('|');
  assert.notEqual(sig(key), sig(json(c.files.key))); assert.notEqual(A.packetId, c.packetId);
  await assert.rejects(build({ seed: 'short' }, 'd'), /at least 20/);
  const r = await build({ seed: undefined }, 'e');
  assert.match(json(r.files.key).seed, /^[0-9a-f]{32}$/);
  assert.ok(fs.readFileSync(r.files.html, 'utf8').indexOf(json(r.files.key).seed) < 0);
});

/* ---- the vocabulary ---- */
const scan = (h, m, d) => LEAK.scanArrange(h, m, d, { seed: SEED, credit: PAGE.CREDIT, titles: [] });
test('leak scan: no word of the two methods (lead sheet, 리드 시트, reduce, 덜어내, the composer line\'s suffix, the relaxed note) and no version stamp or seed in the page, the manifest or any drawing', () => {
  const drawings = PAGE.drawingsOf(html);
  assert.deepEqual(scan(html, manifestText, drawings), []);
  assert.deepEqual(LEAK.scanArrange(html, manifestText, drawings, { seed: SEED, credit: PAGE.CREDIT, titles: ['Piece nearer'] }), []);
  assert.ok(!/\.reduce\(/.test(html), 'the script has no Array.prototype.reduce');
  assert.ok(/localStorage/.test(html), 'the page does use it');
  const k = JSON.stringify(key);
  ['leadsheet', 'reduce', 'LEADSHEET_NO_MELODY', 'UNREACHABLE'].forEach(w => assert.ok(k.indexOf(w) > 0, w + ' is in the key'));
  /* the words of the app's own text for the lead sheet's chip, its composer line and the relaxed note are in the scan */
  ['lead sheet', '리드 시트', 'reduce', '덜어내', '난이도보다 어려울', '(lead sheet)'].forEach(w => assert.ok(LEAK.scanArrange('x ' + w + ' y', '', {}, {}).length > 0, w));
  const ko = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n/ko-KR.json'), 'utf8'));
  const flat = JSON.stringify(ko);
  ['리드 시트로 편곡', '덜어내서'].forEach(w => assert.ok(flat.indexOf(w) > 0, 'the app still says ' + w + ' (the scan\'s words come from it)'));
});

test('mutation: each word of the methods planted in the introduction, a class, an id, a drawing (the composer line, a note), the shared fragments, the manifest, a title or a script is caught by the scan', () => {
  const drawings = PAGE.drawingsOf(html), clone = d => JSON.parse(JSON.stringify(d));
  const first = Object.keys(drawings)[0];
  const planted = {
    'lead sheet in the introduction': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (lead sheet)</h2>'), manifestText, drawings],
    'the Korean words for the lead sheet': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (리드 시트)</h2>'), manifestText, drawings],
    'the Korean word for thinning out': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (덜어내서)</h2>'), manifestText, drawings],
    'reduce in a class': () => [html.replace('<div class="side" data-side="X">', '<div class="side reduce" data-side="X">'), manifestText, drawings],
    'leadsheet in an id': () => [html.replace('id="sec-i01-', 'id="leadsheet-sec-i01-'), manifestText, drawings],
    'Array reduce in the script': () => [html.replace('(function(){', '(function(){ [1].reduce(function(a){ return a; }, 0);'), manifestText, drawings],
    'the composer line suffix in a drawing': () => { const d = clone(drawings); d[first][0] = d[first][0].replace(/<svg /, '<svg data-composer="PPP one-note-per-hand arrangement (lead sheet)" '); return [html, manifestText, d]; },
    'the relaxed note in a narrow drawing': () => { const d = clone(drawings); d[first][1] = d[first][1].replace(/<svg /, '<svg aria-label="이 편곡은 고른 난이도보다 어려울 수 있어요." '); return [html, manifestText, d]; },
    'relaxed in the page': () => [html.replace('</body>', '<!-- relaxed-plan --></body>'), manifestText, drawings],
    'a method in the manifest': () => [html, manifestText.replace('"label": "A"', '"label": "A", "method": "reduce"'), drawings],
    'a title naming a method': () => [html, manifestText.replace('"title": "Piece nearer"', '"title": "Piece nearer (lead sheet)"'), drawings],
    'the chip\'s line': () => [html.replace('</body>', '<p>녹음된 음을 난이도에 맞게 덜어내서 만들어요</p></body>'), manifestText, drawings],
    'a build stamp': () => [html.replace('검토 번호', 'build 3f2a9c1 검토 번호'), manifestText, drawings],
    'the seed in a comment': () => [html.replace('</body>', '<!-- ' + SEED + ' --></body>'), manifestText, drawings]
  };
  Object.keys(planted).forEach(name => {
    const [h, m, d] = planted[name]();
    assert.ok(h !== html || m !== manifestText || JSON.stringify(d) !== JSON.stringify(drawings), name + ': the mutation changed something');
    assert.ok(scan(h, m, d).length > 0, name + ' was not caught');
  });
});

test('the builder refuses to write a packet whose drawing carries the composer line or the relaxed note, or whose link says "reduce"; and warns about a title that names a method', async () => {
  const dirty = JSON.parse(JSON.stringify(built));
  const part = dirty.fount.result.levels.beginner.leadsheet.part;
  part.svg = part.svg.replace(/<svg /, '<svg data-composer="PPP one-note-per-hand arrangement (lead sheet)" ');
  await assert.rejects(build({ results: dirty }, 'dirty'), /would give the methods away.*lead sheet/);
  const d2 = heardDir(['fount'], { fount: { url: 'https://www.youtube.com/watch?v=reducexxxxx' } });
  await assert.rejects(build({ heard: d2, results: { fount: built.fount } }, 'link'), /would give the methods away.*reduce/);
  const d3 = heardDir(['fount'], { fount: { title: 'Fount (lead sheet cover)' } });
  const logs = [];
  const ok = await build({ heard: d3, results: { fount: built.fount }, log: m => logs.push(m) }, 'title');
  assert.ok(ok.packetId);   /* a title is the piece's own: left out of the page scan (the Lead decides); see --no-titles */
  const nt = await build({ heard: d3, results: { fount: built.fount }, titles: false }, 'notitle');
  assert.ok(fs.readFileSync(nt.files.html, 'utf8').indexOf('Fount') < 0);
});

/* ---- inputs and options ---- */
test('options: --heard is required, --heard-b and --level are refused, --levels is checked, an unknown comparison is refused before any work, one level can be asked for', async () => {
  const base = { mode: 'h10', compare: 'arrange', seed: SEED, heard: D, results: built, out: path.join(tmpDir('o1'), 'p'), keyOut: path.join(tmpDir('o1k'), 'k'), jobs: 1 };
  await assert.rejects(buildPacket(Object.assign({}, base, { heard: undefined })), /--heard <dir> is required with --compare arrange/);
  await assert.rejects(buildPacket(Object.assign({}, base, { heardB: D })), /only for --compare engine/);
  await assert.rejects(buildPacket(Object.assign({}, base, { level: 'beginner' })), /--level is not used with --compare arrange/);
  await assert.rejects(buildPacket(Object.assign({}, base, { levels: 'advanced' })), /--levels is a list of beginner, intermediate/);
  await assert.rejects(buildPacket(Object.assign({}, base, { levels: 'beginner,beginner' })), /--levels is a list/);
  await assert.rejects(buildPacket(Object.assign({}, base, { compare: 'speed' })), /--compare must be 'engine' or 'arrange'/);
  await assert.rejects(buildPacket(Object.assign({}, base, { mode: 'h9' })), /for --mode h10/);
  await assert.rejects(buildPacket(Object.assign({}, base, { out: path.join(REPO, 'zz-arrange-out') })), /inside the repository/);
  assert.equal(fs.existsSync(path.join(REPO, 'zz-arrange-out')), false);
  const one = await buildPacket(Object.assign({}, base, { levels: 'beginner', out: path.join(tmpDir('o2'), 'p'), keyOut: path.join(tmpDir('o2k'), 'k') }));
  const k = json(one.files.key);
  assert.deepEqual(k.options.levels, ['beginner']);
  Object.values(k.items).forEach(it => assert.deepEqual(Object.keys(it.parts), ['B']));
});

test('a piece whose copies cannot be built, drawn or made at all is reported with its reason in the key and on the console, never dropped silently', async () => {
  const d = heardDir(['fount', 'nearer', 'know']);
  fs.writeFileSync(path.join(d, 'know.json'), '{"notes": []}');
  const res = { fount: built.fount, nearer: { ok: false, error: 'Error: boom\n at x' } };
  const logs = [];
  const r = await build({ heard: d, results: res, log: m => logs.push(m) }, 'skip');
  const k = json(r.files.key);
  assert.deepEqual(Object.values(k.items).map(i => i.source.id), ['fount']);
  assert.ok(k.inputs.skipped.some(s => s.id === 'nearer' && /build failed: Error: boom/.test(s.reason)));
  assert.ok(k.inputs.skipped.some(s => s.id === 'know' && /not heard notes/.test(s.reason)));
  assert.ok(logs.some(l => /SKIPPED nearer: build failed/.test(l)) && logs.some(l => /SKIPPED know/.test(l)));
  /* neither method made anything: the piece is skipped, not shown empty */
  const none = { ok: true, result: Object.assign({}, built.fount.result, { levels: { beginner: { leadsheet: cell(false, null), reduce: cell(false, null) }, intermediate: { leadsheet: cell(false, null), reduce: cell(false, null) } } }) };
  await assert.rejects(build({ heard: heardDir(['fount']), results: { fount: none } }, 'none'), /no item could be built.*neither method made a copy/);
});

test('the command line: --compare arrange builds the packet, prints what was made and refused per method and level, and refuses a missing --heard; --list prints the pieces', () => {
  const out = path.join(tmpDir('cli'), 'p'), keyOut = path.join(tmpDir('clik'), 'k'), d = heardDir(['fount']);
  const run = spawnSync(process.execPath, [path.join(REPO, 'review/build.js'), '--mode', 'h10', '--compare', 'arrange', '--heard', d, '--out', out, '--key-out', keyOut, '--seed', SEED, '--jobs', '1', '--levels', 'beginner'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /made \(per level\): lead sheet beginner 1\/1; reduction beginner 1\/1/);
  assert.match(run.stdout, /the page shows 1 pieces: 1 pairs and 0 singles/); assert.match(run.stdout, /about \d+ minutes/);
  assert.ok(fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(keyOut, 'key.json')) && !fs.existsSync(path.join(out, 'key.json')));
  const bad = spawnSync(process.execPath, [path.join(REPO, 'review/build.js'), '--mode', 'h10', '--compare', 'arrange', '--out', out, '--key-out', keyOut], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /--heard <dir> is required with --compare arrange/);
  const list = spawnSync(process.execPath, [path.join(REPO, 'review/build.js'), '--mode', 'h10', '--compare', 'arrange', '--heard', d, '--list'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr); assert.match(list.stdout, /^fount \d+ heard notes/);
});

/* ---- the answers ---- */
/* fake answers: spec = function (item id, part key, part key-entry, side) -> { notes, hand } ; pref(id, part) -> 'X' | 'Y' | 'same' | null (by METHOD for readability: 'leadsheet' | 'reduce' | 'same') */
function ratingsFor(k, o) {
  o = o || {};
  const items = Object.keys(k.items).map(id => {
    const it = k.items[id], r = { id: id };
    Object.keys(it.parts).forEach(pk => {
      const p = it.parts[pk], ans = m => (o.notes ? o.notes(it.source.id, m, p.kind, pk) : 'ok');
      const copy = m => ({ notes: ans(m), hand: o.hand ? o.hand(m) : 'asis' });
      if (p.kind === 'pair') {
        const pref = o.pref ? o.pref(it.source.id, pk) : 'same';
        r[pk] = { preference: pref === 'same' ? 'same' : pref === null ? null : p.X === pref ? 'X' : 'Y', X: copy(p.X), Y: copy(p.Y), text: o.text || '' };
      } else r[pk] = { S: copy(p.S), text: o.text || '' };
    });
    return r;
  });
  return { format: 'ppp-review-ratings/3', mode: 'h10', compare: 'arrange', packetId: k.packetId, reviewer: 'piano teacher', items: items.filter(r => !(o.skip || []).includes(r.id)) };
}

test('decode: every lead-sheet copy accurate and the lead sheet at least similar everywhere -> PASS; the three rules read from the key', () => {
  const o = decode(key, ratingsFor(key));
  assert.equal(o.verdict, 'PASS'); assert.equal(o.compare, 'arrange');
  assert.equal(o.rules.leadNotesAccurate.pass, true); assert.equal(o.rules.leadNotesAccurate.share, 1); assert.equal(o.rules.leadNotesAccurate.copies, key.shown.pairs + key.shown.singles - Object.values(key.items).reduce((n, it) => n + Object.values(it.parts).filter(p => p.kind === 'single' && p.S === 'reduce').length, 0));
  assert.equal(o.rules.noPieceWhereOnlyLeadIsWrong.pass, true); assert.equal(o.rules.leadPreferredOrSimilar.pass, true);
  assert.equal(o.byMethod.leadsheet.copies + o.byMethod.reduce.copies, key.shown.pairs * 2 + key.shown.singles);
  assert.equal(o.answered.copies, o.answered.copiesShown); assert.equal(o.reviewer, 'piano teacher');
  const text = report(o);
  assert.match(text, /VERDICT: PASS/); assert.match(text, /Lead sheet: \d+ copies shown/); assert.match(text, /Reduction: \d+ copies shown/); assert.match(text, /Caveats:/);
  /* a mostly-accurate copy counts as accurate, and the rate is computed over the copies shown */
  assert.equal(decode(key, ratingsFor(key, { notes: () => 'mostly' })).verdict, 'PASS');
});

test('decode: rule 1 - fewer than 80% of the lead-sheet copies accurate fails (the share is over the copies SHOWN, a piece\'s two levels are two copies unless merged)', () => {
  const lead = [];
  Object.values(key.items).forEach(it => Object.keys(it.parts).forEach(pk => { const p = it.parts[pk]; if (p.kind === 'pair' ? true : p.S === 'leadsheet') lead.push(it.source.id + pk); }));
  const wrongOne = ratingsFor(key, { notes: (src, m, kind, pk) => m === 'leadsheet' && src === 'nearer' && pk === 'B' ? 'many' : 'ok' });
  const o = decode(key, wrongOne);
  assert.equal(o.rules.leadNotesAccurate.many, 1);
  const n = o.rules.leadNotesAccurate.copies;
  assert.equal(o.rules.leadNotesAccurate.pass, (n - 1) / n >= 0.8 - 1e-9, 'one wrong of ' + n);
  const mostly = decode(key, ratingsFor(key, { notes: (src, m) => m === 'leadsheet' && ['know', 'nearer'].includes(src) ? 'many' : 'ok' }));
  assert.equal(mostly.rules.leadNotesAccurate.pass, false); assert.equal(mostly.verdict, 'FAIL'); assert.match(report(mostly), /FAILS/);
});

test('decode: rule 2 - a pair whose lead-sheet copy is 틀린 곳이 많아요 and whose reduction copy is not fails, even if the share holds; both wrong is not that; a lead copy wrong where the reduction made none is rule 1\'s', () => {
  const only = decode(key, ratingsFor(key, { notes: (src, m, kind, pk) => src === 'gather' && m === 'leadsheet' ? 'many' : 'ok' }));
  assert.equal(only.rules.noPieceWhereOnlyLeadIsWrong.pass, false); assert.ok(only.rules.noPieceWhereOnlyLeadIsWrong.violations.every(v => /\(gather\)/.test(v))); assert.deepEqual(only.rules.noPieceWhereOnlyLeadIsWrong.pieces, ['gather']);
  assert.equal(only.verdict, 'FAIL');
  const both = decode(key, ratingsFor(key, { notes: (src, m) => src === 'gather' ? 'many' : 'ok' }));
  assert.equal(both.rules.noPieceWhereOnlyLeadIsWrong.pass, true, 'both copies are wrong: the lead sheet is not the only one');
  const single = decode(key, ratingsFor(key, { notes: (src, m) => src === 'know' ? 'many' : 'ok' }));
  assert.equal(single.rules.noPieceWhereOnlyLeadIsWrong.pass, true); assert.ok(single.rules.noPieceWhereOnlyLeadIsWrong.leadWrongWhereReductionMadeNone.length > 0);
  assert.match(report(single), /not part of this rule/);
});

test('decode: rule 3 - the lead sheet preferred or similar on at least 80% of the pairs; preferring the reduction on enough of them fails', () => {
  const bad = decode(key, ratingsFor(key, { pref: () => 'reduce' }));
  assert.equal(bad.rules.leadPreferredOrSimilar.pass, false); assert.equal(bad.rules.leadPreferredOrSimilar.reducePreferred, key.shown.pairs); assert.equal(bad.verdict, 'FAIL');
  const lead = decode(key, ratingsFor(key, { pref: () => 'leadsheet' }));
  assert.equal(lead.rules.leadPreferredOrSimilar.leadPreferred, key.shown.pairs); assert.equal(lead.verdict, 'PASS');
  /* three pairs: one preference for the reduction is 2 of 3 = 67%, under 80% */
  const one = decode(key, ratingsFor(key, { pref: (src, pk) => src === 'fount' ? 'reduce' : 'leadsheet' }));
  assert.equal(one.rules.leadPreferredOrSimilar.pass, false);
});

test('decode: answers missing -> INCOMPLETE unless the missing ones cannot change a rule; an unanswered piece is counted in the worst and the best case', () => {
  const none = decode(key, ratingsFor(key, { skip: Object.keys(key.items) }));
  assert.equal(none.verdict, 'INCOMPLETE'); assert.equal(none.rules.leadNotesAccurate.pass, null); assert.equal(none.rules.leadNotesAccurate.worst, 0); assert.equal(none.rules.leadNotesAccurate.best, 1);
  assert.equal(none.answered.pieces, 0);
  /* one piece unanswered, the rest accurate: 80% needs the missing ones, so undecided; two wrong and the rest missing is already a FAIL */
  const some = decode(key, ratingsFor(key, { skip: [Object.keys(key.items)[0]] }));
  assert.ok(['INCOMPLETE', 'PASS'].includes(some.verdict));
  const failing = decode(key, ratingsFor(key, { skip: [Object.keys(key.items)[0]], notes: (src, m) => m === 'leadsheet' ? 'many' : 'ok' }));
  assert.equal(failing.verdict, 'FAIL', 'a rule that is already broken stays broken');
  const sr = require(path.join(REPO, 'review/h10/decode-arrange.js')).shareRule;
  assert.deepEqual([sr(8, 10, 0, 0.8).pass, sr(7, 10, 0, 0.8).pass, sr(7, 10, 1, 0.8).pass, sr(7, 10, 3, 0.8).pass, sr(5, 10, 3, 0.8).pass, sr(5, 10, 2, 0.8).pass, sr(0, 0, 0, 0.8).pass], [true, false, null, null, null, false, null]);
});

test('decode: the numbers are the KEY\'s - a stricter rule in the key changes the verdict of the same answers; a key without a rule, another packet, another format and an invalid answer are refused', () => {
  const r = ratingsFor(key, { notes: (src, m, kind, pk) => m === 'leadsheet' && src === 'nearer' && pk === 'B' ? 'many' : 'ok', pref: () => 'same' });
  const strict = JSON.parse(JSON.stringify(key)); strict.passRule.leadNotesAccurateShare = 1;
  const loose = JSON.parse(JSON.stringify(key)); loose.passRule.leadNotesAccurateShare = 0.1; loose.passRule.noPieceWhereOnlyLeadIsWrong = true;
  assert.equal(decode(strict, r).rules.leadNotesAccurate.pass, false);
  assert.equal(decode(loose, r).rules.leadNotesAccurate.pass, true);
  const norule = JSON.parse(JSON.stringify(key)); delete norule.passRule;
  assert.throws(() => decode(norule, ratingsFor(key)), /no pass rule/);
  assert.throws(() => decode(key, Object.assign({}, ratingsFor(key), { packetId: 'zzz' })), /the key is for packet/);
  assert.throws(() => decode(key, Object.assign({}, ratingsFor(key), { format: 'ppp-review-ratings/2' })), /not a ratings file exported by the lead-sheet review page/);
  const badAnswer = ratingsFor(key); badAnswer.items[0][Object.keys(key.items[badAnswer.items[0].id].parts)[0]].X = { notes: 'great', hand: 'asis' };
  assert.throws(() => decode(key, badAnswer), /invalid/);
  const twice = ratingsFor(key); twice.items.push(twice.items[0]);
  assert.throws(() => decode(key, twice), /rated twice/);
  const other = ratingsFor(key); other.items.push({ id: 'i99' });
  assert.throws(() => decode(key, other), /does not have: i99/);
  assert.throws(() => decode(Object.assign({}, key, { compare: 'engine' }), ratingsFor(key)), /not an H-10 ratings file/, 'a key of another comparison does not read these answers');
});

test('the answers in the artifact database (answers/<packet>/items/<id>, answers/<packet>) become the same ratings the page exports; decode reads either; the command line does too', () => {
  const page = ratingsFor(key, { pref: (src, pk) => src === 'fount' ? 'reduce' : 'leadsheet', text: 'ok' });
  /* what the page stores: pref instead of preference, one object per part */
  const rows = page.items.map(it => {
    const data = { id: it.id, packetId: key.packetId, t: 5, v: 1 };
    Object.keys(it).forEach(pk => { if (pk === 'id') return; const p = it[pk]; data[pk] = p.S ? { S: p.S, text: p.text } : { pref: p.preference, X: p.X, Y: p.Y, text: p.text }; });
    return { path: 'answers/' + key.packetId + '/items/' + it.id, data: data };
  });
  rows.push({ path: 'answers/' + key.packetId, data: { packetId: key.packetId, role: 'piano teacher', t: 1, v: 1 } });
  rows.push({ path: 'answers/other/items/i01', data: { id: 'i01', packetId: 'other', t: 9, B: { S: { notes: 'many', hand: 'no' } } } });
  const fromDb = DB.dbToRatingsArrange(rows, key.packetId);
  assert.equal(fromDb.format, 'ppp-review-ratings/3'); assert.equal(fromDb.compare, 'arrange'); assert.equal(fromDb.reviewer, 'piano teacher');
  assert.deepEqual(fromDb.items, page.items, 'the same ratings as the page\'s export');
  assert.deepEqual(decode(key, fromDb), decode(key, page));
  /* the newer document of an item wins; documents of another packet are ignored; a newer t with fewer parts is still the newer */
  const older = JSON.parse(JSON.stringify(rows[0])); older.data.t = 1; older.path += '';
  assert.deepEqual(DB.dbToRatingsArrange([rows[0], older], key.packetId).items[0], DB.dbToRatingsArrange([rows[0]], key.packetId).items[0]);
  /* an object of paths works as a list */
  const obj = {}; rows.forEach(r => { obj[r.path] = r.data; });
  assert.deepEqual(DB.dbToRatingsArrange(obj, key.packetId).items, page.items);
  /* the command line, both ways, with a key file */
  const dir = tmpDir('dec'), kf = path.join(dir, 'key.json'), rf = path.join(dir, 'ratings.json'), df = path.join(dir, 'rows.json'), of = path.join(dir, 'out.json');
  fs.writeFileSync(kf, JSON.stringify(key)); fs.writeFileSync(rf, JSON.stringify(page)); fs.writeFileSync(df, JSON.stringify(rows));
  const a = spawnSync(process.execPath, [path.join(REPO, 'review/decode.js'), '--mode', 'h10', '--compare', 'arrange', '--key', kf, '--ratings', rf, '--out', of], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /VERDICT: (PASS|FAIL|INCOMPLETE)/); assert.equal(json(of).compare, 'arrange');
  const b = spawnSync(process.execPath, [path.join(REPO, 'review/decode.js'), '--mode', 'h10', '--key', kf, '--db', df], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr); assert.equal(b.stdout, a.stdout, 'the database rows and the export decode the same'); assert.match(b.stderr, /lead-sheet review key: decoded as one/);
  const wrong = spawnSync(process.execPath, [path.join(REPO, 'review/decode.js'), '--compare', 'engine', '--key', kf, '--ratings', rf], { encoding: 'utf8' });
  assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /not an engine-comparison key/);
});
