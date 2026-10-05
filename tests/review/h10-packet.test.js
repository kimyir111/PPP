/* G10a-5 (H-10): whole packets built from heard-notes fixtures (real Onsets & Frames runs on rendered public-domain scores, tests/bench/replay-of):
   determinism, the blind assignment, the leak scan (and a mutation test: planted leaks are caught), symmetry of the two sides, what is drawn against the
   Score, the same seconds for both ways, the key, skipped pieces reported, the size of a ten-piece page, parallel builds equal to sequential ones,
   and the decode of a fake set of answers against the key. */
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, heardDir, heardOf, leakScan, FIXTURES, tmpDir } = require('./h10-helpers.js');
const { readAll } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const { decode } = require(path.join(REPO, 'review/decode.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
const PACKET = require(path.join(REPO, 'review/h10/packet.js'));

const SEED = 'h10-test-secret-seed-0123456789';
const NAMES = ['nearer', 'know', 'notone'];
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const build = (names, seed, extra, tag) => buildPacket(Object.assign({ mode: 'h10', seed: seed, heard: heardDir(names), out: path.join(tmpDir('h10p' + (tag || '')), 'packet'), keyOut: path.join(tmpDir('h10k' + (tag || '')), 'key'), jobs: 1 }, extra || {}));

let A, html, manifestText, key;
before(async () => {
  A = await build(NAMES, SEED, {}, 'a');
  html = fs.readFileSync(A.files.html, 'utf8');
  manifestText = fs.readFileSync(A.files.manifest, 'utf8');
  key = json(A.files.key);
});

test('the packet is two files; the manifest gives X and Y the same fields and says nothing of how they were made', () => {
  assert.deepEqual(Object.keys(readAll(A.outDir)), ['index.html', 'manifest.json']);
  const m = json(A.files.manifest);
  assert.equal(m.review, 'H-10'); assert.equal(m.items.length, 3);
  assert.equal(m.items.map(i => i.id).join(','), 'i01,i02,i03', 'ids are the shown order and carry nothing else');
  assert.equal(m.items.map(i => i.label).join(','), 'A,B,C');
  m.items.forEach(it => {
    assert.deepEqual(it.versions, [{ label: 'X' }, { label: 'Y' }]);
    assert.deepEqual(it.parts, ['T', 'A']);
    assert.ok(it.excerpt.endSeconds > it.excerpt.startSeconds);
  });
  ['seed', 'v2', 'classic', 'hmac', 'assign', 'key'].forEach(w => assert.ok(manifestText.toLowerCase().indexOf(w) < 0, 'manifest mentions ' + w));
});

test('determinism: the same seed and heard notes give byte-identical files, whatever order the items are listed in; another seed changes sides or order', async () => {
  const b = await build(NAMES.slice().reverse(), SEED, {}, 'b');
  const ra = readAll(A.outDir), rb = readAll(b.outDir);
  Object.keys(ra).forEach(f => assert.ok(ra[f].equals(rb[f]), f + ' differs when the item order differs'));
  const strip = k => { const o = JSON.parse(JSON.stringify(k)); delete o.inputs.buildSeconds; Object.values(o.items).forEach(i => ['classic', 'v2'].forEach(a => { if (i.arms[a].arrange) i.arms[a].arrange.ms = 0; })); return JSON.stringify(o); };
  assert.equal(strip(key), strip(json(b.files.key)), 'the key is the same (but for the clock)');
  const c = await build(NAMES, 'h10-test-another-secret-seed-9876543210', {}, 'c');
  const sig = k => Object.keys(k.items).map(id => id + ':' + k.items[id].source.id + ':' + k.items[id].X).join('|');
  assert.notEqual(sig(key), sig(json(c.files.key)));
  assert.notEqual(A.packetId, c.packetId);
  assert.equal(json(c.files.key).seed, 'h10-test-another-secret-seed-9876543210');
});

test('seeds under 20 characters are refused; an omitted seed is random and only in the key', async () => {
  await assert.rejects(build(NAMES, 'short', {}, 'd'), /at least 20/);
  const r = await build(NAMES.slice(0, 1), undefined, {}, 'e');
  const k = json(r.files.key);
  assert.match(k.seed, /^[0-9a-f]{32}$/);
  assert.ok(fs.readFileSync(r.files.html, 'utf8').indexOf(k.seed) < 0 && fs.readFileSync(r.files.manifest, 'utf8').indexOf(k.seed) < 0);
});

test('leak scan: no arm name, version or build stamp, nor the seed, in the page, the manifest or any drawing (unpacked)', () => {
  const drawings = PAGE.drawingsOf(html);
  assert.equal(Object.keys(drawings).length, 3 * 2 * 2, 'three pieces, two parts, X and Y');
  assert.deepEqual(leakScan(html, manifestText, drawings, SEED), []);
  /* the key is where those words live */
  assert.ok(JSON.stringify(key).indexOf('classic') > 0 && JSON.stringify(key).indexOf(SEED) > 0);
});

test('mutation: a leak planted in the page, a class, a drawing, the shared fragments, the manifest or a version stamp is caught by the scan', () => {
  const drawings = PAGE.drawingsOf(html);
  const clone = d => JSON.parse(JSON.stringify(d));
  const planted = {
    'a word in the introduction': () => [html.replace('<h2>진행 방법</h2>', '<h2>진행 방법 (v2 비교)</h2>'), manifestText, drawings],
    'a class that names an arm': () => [html.replace('<div class="side" data-side="X">', '<div class="side classic-arm" data-side="X">'), manifestText, drawings],
    'an id that names an arm': () => [html.replace('id="sec-i01-T"', 'id="sec-i01-T-legacy"'), manifestText, drawings],
    'a drawing attribute': () => { const d = clone(drawings); d.i01tX[0] = d.i01tX[0].replace('<g class="ppp-system">', '<g class="ppp-system" data-arm="classic">'); return [html, manifestText, d]; },
    'a glyph id suffix in a drawing': () => { const d = clone(drawings); d.i02aY[1] = d.i02aY[1].replace(/<svg /, '<svg id="score-v2" '); return [html, manifestText, d]; },
    'a title suffix in the manifest': () => [html, manifestText.replace('"title": "Piece nearer"', '"title": "Piece nearer (classic)"'), drawings],
    'a build stamp in the footer': () => [html.replace('검토 번호', 'build 3f2a9c1 검토 번호'), manifestText, drawings],
    'the seed in a comment': () => [html.replace('</body>', '<!-- ' + SEED + ' --></body>'), manifestText, drawings],
    'a mention of the hands fallback in a script': () => [html.replace('(function(){', '(function(){ /* hands fallback */'), manifestText, drawings]
  };
  Object.keys(planted).forEach(name => {
    const [h, m, d] = planted[name]();
    assert.ok(h !== html || m !== manifestText || JSON.stringify(d) !== JSON.stringify(drawings), name + ': the mutation changed something');
    const bad = leakScan(h, m, d, SEED);
    assert.ok(bad.length > 0, name + ' was not caught');
  });
  /* and path data holding more than path characters is not waved through */
  const d = clone(drawings); d.i01tX[0] = d.i01tX[0].replace(/ d="M/, ' d="legacy M');
  assert.ok(leakScan(html, manifestText, d, SEED).length > 0);
});

test('X and Y are one structure: every part of every piece has the same markup for both sides, and the page has no id or class that is only on one side', () => {
  const sec = html.match(/<section class="part"[\s\S]*?<\/section>/g);
  assert.equal(sec.length, 6);
  sec.forEach(s => {
    const sides = s.match(/<div class="side" data-side="[XY]">[\s\S]*?(?=<div class="side"|<div class="pref">)/g);
    assert.equal(sides.length, 2);
    const norm = t => t.replace(/data-side="[XY]"/g, 'data-side="S"').replace(/data-play="[XY]"/g, 'data-play="S"').replace(/data-svg="(i\d\d[ta])[XY]"/g, 'data-svg="$1S"')
      .replace(/ style="--arw:[\d. /]+;--arn:[\d. /]+"/g, '')   /* the box's reserved shape is the drawing's own (its viewBox) */
      .replace(/data-speed="[XY]"/g, 'data-speed="S"').replace(/<h4>[XY]<\/h4>/, '<h4>S</h4>').replace(/aria-label="[XY] /g, 'aria-label="S ').replace(/>[XY] 악보를/, '>S 악보를');
    assert.equal(norm(sides[0]), norm(sides[1]), 'the two sides differ in more than their label');
  });
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  ids.filter(i => !/^g-/.test(i)).forEach(i => assert.ok(/^(item-i\d\d|sec-i\d\d-[TA]|role|save-state|progress|meter-fill|resume-btn|summary|summary-status|summary-open|summary-open-wrap|export-btn|copy-btn|export-json|clear-btn|piano-samples|svg-dict|svg-data|packet-data)$/.test(i), 'an id: ' + i));
});

test('what is drawn is what the Score holds: heads and rests equal in both layouts for every drawing; the same seconds are shown for both ways', () => {
  Object.keys(key.items).forEach(id => {
    const it = key.items[id];
    ['classic', 'v2'].forEach(a => {
      const arm = it.arms[a];
      ['T', 'A'].forEach(p => {
        const c = arm.counts[p];
        assert.ok(c, id + ' ' + a + ' ' + p + ' is drawn');
        ['wide', 'narrow'].forEach(l => {
          assert.equal(c[l].heads, c.score.heads, id + ' ' + a + ' ' + p + ' ' + l + ' heads');
          assert.equal(c[l].rests, c.score.rests, id + ' ' + a + ' ' + p + ' ' + l + ' rests');
        });
        assert.equal(c.struck, c.score.heads - c.score.tieStops, id + ' ' + a + ' ' + p + ' struck notes');
        assert.ok(c.wide.heads > 0);
      });
      assert.ok(arm.covers[0] <= it.excerpt.start + 1e-6 && arm.covers[1] >= it.excerpt.end - 1e-6, id + ' ' + a + ' covers the excerpt');
      assert.equal(it.excerpt.arms[a].count, arm.barsShown);
    });
    /* the two ways cover the same seconds to within a bar at each end */
    const w = ['classic', 'v2'].map(a => it.arms[a].covers);
    const bar = Math.max(it.excerpt.barSeconds * 2, 6);
    assert.ok(Math.abs(w[0][0] - w[1][0]) < bar && Math.abs(w[0][1] - w[1][1]) < bar, id + ' both ways show about the same seconds: ' + JSON.stringify(w));
  });
});

test('the key holds everything about how each score was made, and none of it is in the packet; the paths are outside every git tree', () => {
  assert.equal(key.mode, 'h10'); assert.equal(key.seed, SEED); assert.equal(key.packetId, A.packetId); assert.ok(key.builtFrom);
  assert.deepEqual(key.passRule, PACKET.PASS_RULE);
  assert.equal(Object.keys(key.items).length, 3);
  Object.values(key.items).forEach(it => {
    assert.ok(['v2', 'classic'].includes(it.X) && ['v2', 'classic'].includes(it.Y) && it.X !== it.Y);
    assert.equal(it.arms.v2.wroteV2, true); assert.equal(it.arms.classic.wroteV2, false);
    assert.ok('handsFallback' in it.arms.v2.arrange && 'v2Rejected' in it.arms.v2);
    assert.ok(it.heard.digest && it.heard.notes > 4);
  });
  assert.ok(path.relative(A.outDir, A.keyDir).startsWith('..') && path.relative(A.keyDir, A.outDir).startsWith('..'));
  assert.equal(fs.existsSync(path.join(A.outDir, 'key.json')), false);
});

test('output guards: nothing inside the repository, the key apart from the packet folder, and a refusal happens before any work', async () => {
  await assert.rejects(buildPacket({ mode: 'h10', heard: heardDir(['know']), out: path.join(REPO, 'zz-h10-out'), keyOut: path.join(tmpDir('g'), 'k') }), /inside the repository/);
  const base = tmpDir('guard');
  await assert.rejects(buildPacket({ mode: 'h10', heard: heardDir(['know']), out: path.join(base, 'p'), keyOut: path.join(base, 'p', 'key') }), /separate trees/);
  await assert.rejects(buildPacket({ mode: 'h10', heard: heardDir(['know']), out: path.join(base, 'x', 'p'), keyOut: path.join(base, 'x', 'k') }), /separate trees/, 'a sibling is refused: zipping the folder would ship the key');
  await assert.rejects(buildPacket({ mode: 'h10', heard: heardDir(['know']), out: path.join(tmpDir('g2'), 'p') }), /--key-out is required/);
  assert.equal(fs.existsSync(path.join(REPO, 'zz-h10-out')), false);
});

test('a piece that was not collected is reported in the key with the collector\'s reason, never dropped silently; unusable files too; nothing at all is an error', async () => {
  const dir = heardDir(['know', 'nearer', 'notone']);
  fs.rmSync(path.join(dir, 'nearer.json'));
  fs.writeFileSync(path.join(dir, 'notone.json'), '{"notes": []}');
  fs.writeFileSync(path.join(dir, 'collect-status.json'), JSON.stringify({ format: 'ppp-h10-collect/1', items: { nearer: { status: 'refused', error: 'download-failed' } } }));
  const logs = [];
  const r = await buildPacket({ mode: 'h10', seed: SEED, heard: dir, out: path.join(tmpDir('s1'), 'p'), keyOut: path.join(tmpDir('s1k'), 'k'), jobs: 1, log: m => logs.push(m) });
  assert.equal(r.count, 1);
  const sk = json(r.files.key).inputs.skipped;
  assert.deepEqual(sk.map(s => s.id).sort(), ['nearer', 'notone']);
  assert.match(sk.find(s => s.id === 'nearer').reason, /refused.*download-failed/);
  assert.match(sk.find(s => s.id === 'notone').reason, /not heard notes/);
  assert.ok(logs.some(l => /SKIPPED nearer/.test(l)) && logs.some(l => /SKIPPED notone/.test(l)), 'said on the console too');
  const none = heardDir(['know']); fs.rmSync(path.join(none, 'know.json'));
  await assert.rejects(buildPacket({ mode: 'h10', seed: SEED, heard: none, out: path.join(tmpDir('s2'), 'p'), keyOut: path.join(tmpDir('s2k'), 'k'), jobs: 1 }), /no item could be built/);
  await assert.rejects(buildPacket({ mode: 'h10', seed: SEED, heard: tmpDir('empty'), out: path.join(tmpDir('s3'), 'p'), keyOut: path.join(tmpDir('s3k'), 'k'), jobs: 1 }), /no items\.json/);
});

test('two pieces whose scores are identical on a side are refused (a repeated score would reveal which is which)', async () => {
  const dir = heardDir(['know']);
  fs.writeFileSync(path.join(dir, 'twin.json'), fs.readFileSync(path.join(dir, 'know.json')));
  const items = json(path.join(dir, 'items.json')); items.push({ id: 'twin', url: items[0].url, title: 'twin' });
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(items));
  await assert.rejects(buildPacket({ mode: 'h10', seed: SEED, heard: dir, out: path.join(tmpDir('t1'), 'p'), keyOut: path.join(tmpDir('t1k'), 'k'), jobs: 1 }), /identical to/);
});

test('a piece whose two ways draw identically (the page threw v2 away, or the readings agree) is kept, and the key and the console say so', async () => {
  const jobs = [{ id: 'know', title: 'Piece know', heard: heardOf('know'), excerpt: {} }];
  const built = await PACKET.buildItems(jobs, { jobs: 1 });
  const r = built.know.result;
  ['T', 'A'].forEach(p => { r.arms.v2[p] = r.arms.classic[p]; });
  r.arms.v2.key.v2Rejected = true;
  const logs = [];
  const out = await buildPacket({ mode: 'h10', seed: SEED, heard: heardDir(['know']), out: path.join(tmpDir('same'), 'p'), keyOut: path.join(tmpDir('samek'), 'k'), results: built, jobs: 1, log: m => logs.push(m) });
  const k = json(out.files.key).items.i01;
  assert.deepEqual(k.identicalSides, { T: true, A: true });
  assert.equal(k.arms.v2.v2Rejected, true);
  assert.ok(logs.some(l => /drawn identically/.test(l)));
  const s = decode(json(out.files.key), answersFrom(json(out.files.key), () => ({ preference: 'same', X: sideRating(true), Y: sideRating(true) })));
  assert.equal(s.perPiece[0].identicalSides.T, true);
  assert.equal(s.perPiece[0].v2Rejected, true);
});

test('titles can be left out (--no-titles) and the link opens the original at the excerpt (a plain link, nothing embedded)', async () => {
  const r = await build(['know'], SEED, { titles: false }, 'nt');
  const h = fs.readFileSync(r.files.html, 'utf8');
  assert.ok(h.indexOf('Piece know') < 0);
  assert.ok(html.indexOf('Piece nearer') > 0, 'with titles they are shown');
  const links = [...html.matchAll(/<a class="btn small" href="([^"]+)" target="_blank" rel="noopener noreferrer">/g)].map(m => m[1].replace(/&amp;/g, '&'));
  assert.equal(links.length, 3);
  links.forEach(l => assert.match(l, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}&t=\d+s$/));
  assert.ok(!/<iframe|<audio|<video|<embed|<object/i.test(html), 'no embedded player');
  assert.ok(!/(?:src|href)="https?:/.test(html.replace(/<a class="btn small" href="[^"]+"/g, '')), 'no other external URL');
});

/* ---- decode ---- */
function answersFrom(k, f) {
  return { format: 'ppp-review-ratings/2', mode: 'h10', packetId: k.packetId, reviewer: 'piano teacher', exportedAt: 'x',
    items: Object.keys(k.items).map(id => { const o = { id: id }; k.items[id].parts.forEach(p => { o[p] = f(k.items[id], p, id); }); return o; }) };
}
const sideFor = (it, arm) => (it.X === arm ? 'X' : 'Y');
const sideRating = (pass, tags, text) => ({ pass: pass, tags: tags || [], text: text || '' });

test('decode: a fake set of answers gives the per-arm counts the key says (preference, pass, tags, per part, per piece, the starting rule)', () => {
  /* the teacher prefers v2 on part T of every piece and says v2 passes there; the classic fails on rests; on part A she prefers the classic on the first piece only */
  const ans = answersFrom(key, (it, p, id) => {
    const o = { preference: null, X: sideRating(null), Y: sideRating(null) };
    if (p === 'T') {
      o.preference = sideFor(it, 'v2'); o[sideFor(it, 'v2')] = sideRating(true); o[sideFor(it, 'classic')] = sideRating(false, ['rests', 'bars-metre'], 'wedged rests in ' + id);
    } else {
      o.preference = id === 'i01' ? sideFor(it, 'classic') : 'same';
      o[sideFor(it, 'v2')] = sideRating(id !== 'i01', id === 'i01' ? ['hands'] : []); o[sideFor(it, 'classic')] = sideRating(true);
    }
    return o;
  });
  const s = decode(key, ans);
  assert.equal(s.pieces, 3);
  assert.deepEqual([s.byPart.T.preference.v2, s.byPart.T.preference.classic, s.byPart.T.preference.similar, s.byPart.T.preference.unrated], [3, 0, 0, 0]);
  assert.deepEqual([s.byPart.A.preference.v2, s.byPart.A.preference.classic, s.byPart.A.preference.similar], [0, 1, 2]);
  assert.deepEqual([s.overall.preference.v2, s.overall.preference.classic, s.overall.preference.similar], [3, 1, 2]);
  assert.equal(s.byPart.T.pass.v2.pass, 3); assert.equal(s.byPart.T.pass.classic.fail, 3);
  assert.equal(s.byPart.A.pass.v2.pass, 2); assert.equal(s.byPart.A.pass.v2.fail, 1);
  assert.deepEqual(s.byPart.T.tags.classic, { rests: 3, 'bars-metre': 3 }); assert.deepEqual(s.byPart.T.tags.v2, {});
  assert.deepEqual(s.byPart.A.tags.v2, { hands: 1 });
  assert.equal(s.byPart.T.notes.classic.length, 3);
  assert.equal(s.byPart.T.startingRule.allMet, true);
  assert.deepEqual(s.byPart.T.startingRule.onlyV2Fails.pieces, []);
  assert.equal(s.byPart.T.startingRule.v2HandedToAStudent.share, 1);
  assert.equal(s.byPart.A.startingRule.v2AtLeastAsGood.share, 0.667);
  assert.equal(s.byPart.A.startingRule.allMet, false, '2 of 3 is under 0.8');
  assert.equal(s.perPiece.length, 3);
  assert.equal(s.perPiece[0].parts.T.preference, 'v2');
  assert.equal(s.perPiece[0].xIs, key.items.i01.X);
  assert.equal(s.arrangerOutcome.bothArranged, 3);
  assert.ok(s.visible.length === 2 && s.visible[0].pieces === 3);
  const text = require(path.join(REPO, 'review/decode.js')).report(s);
  assert.match(text, /Part T \(the transcription\)/); assert.match(text, /Caveats:/); assert.match(text, /starting rule/);
});

test('decode: the same answers with X and Y swapped in the key give the swapped result (the key is what makes the count right), and "only v2 fails" is found', () => {
  const swapped = JSON.parse(JSON.stringify(key));
  Object.values(swapped.items).forEach(it => { const x = it.X; it.X = it.Y; it.Y = x; });
  const ans = answersFrom(key, (it, p) => ({ preference: 'X', X: sideRating(false), Y: sideRating(true) }));   /* X always fails, Y always passes */
  const a = decode(key, ans), b = decode(swapped, ans);
  const xv2 = Object.keys(key.items).filter(id => key.items[id].X === 'v2').length;
  assert.equal(a.byPart.T.preference.v2, xv2); assert.equal(b.byPart.T.preference.v2, 3 - xv2); assert.equal(b.byPart.T.preference.classic, xv2);
  const keep = Object.keys(key.items).filter(id => key.items[id].X === 'v2');
  assert.deepEqual(a.byPart.T.startingRule.onlyV2Fails.pieces.sort(), keep.sort(), 'v2 fails (as X) while classic passes: those pieces');
  assert.equal(a.byPart.T.startingRule.onlyV2Fails.met, keep.length === 0);
});

test('decode: refuses what is not this packet, a rating for an unknown piece, a piece rated twice, an invalid preference; unanswered parts are counted as unanswered', () => {
  const ok = answersFrom(key, () => ({ preference: null, X: sideRating(null), Y: sideRating(null) }));
  const s = decode(key, ok);
  assert.equal(s.overall.preference.unrated, 6); assert.equal(s.overall.pass.v2.unrated, 6); assert.equal(s.byPart.T.startingRule.complete, false);
  assert.throws(() => decode(key, Object.assign({}, ok, { packetId: 'other' })), /packet/);
  assert.throws(() => decode(key, Object.assign({}, ok, { mode: 'h9' })), /ratings file/);
  assert.throws(() => decode(key, Object.assign({}, ok, { format: 'ppp-review-ratings/1' })), /ratings file/);
  assert.throws(() => decode(key, Object.assign({}, ok, { items: ok.items.concat([{ id: 'i99' }]) })), /does not have/);
  assert.throws(() => decode(key, Object.assign({}, ok, { items: ok.items.concat([ok.items[0]]) })), /twice/);
  const bad = JSON.parse(JSON.stringify(ok)); bad.items[0].T.preference = 'Z';
  assert.throws(() => decode(key, bad), /invalid preference/);
  assert.throws(() => decode(Object.assign({}, key, { mode: 'h9' }), ok), /./);
  assert.throws(() => decode(Object.assign({}, key, { format: 'x' }), ok), /not an H-10 review key|not a review key/);
});

test('the command line: decode --mode h10 prints the report and refuses a mode that is not the key\'s', () => {
  const { spawnSync } = require('child_process');
  const dir = tmpDir('cli');
  const ans = answersFrom(key, (it, p) => ({ preference: sideFor(it, 'v2'), X: sideRating(true), Y: sideRating(true) }));
  fs.writeFileSync(path.join(dir, 'ratings.json'), JSON.stringify(ans));
  const run = args => spawnSync(process.execPath, [path.join(REPO, 'review/decode.js')].concat(args), { encoding: 'utf8' });
  const r = run(['--mode', 'h10', '--key', A.files.key, '--ratings', path.join(dir, 'ratings.json'), '--out', path.join(dir, 'summary.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Packet .* \(H-10\), 3 pieces/);
  assert.equal(json(path.join(dir, 'summary.json')).mode, 'h10');
  const bad = run(['--mode', 'h8', '--key', A.files.key, '--ratings', path.join(dir, 'ratings.json')]);
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /mode h8 but the key is for mode h10/);
});

test('answers read out of the artifact database (documents answers/<packet>/items/<id>) decode exactly like the exported file, from a list or a map, and other packets are ignored', () => {
  const { dbToRatings } = require(path.join(REPO, 'review/h10/db-to-ratings.js'));
  const ans = answersFrom(key, (it, p, id) => ({ preference: id === 'i02' ? 'same' : sideFor(it, 'v2'), X: sideRating(p === 'T', p === 'T' ? [] : ['hands'], 'x' + id), Y: sideRating(p !== 'T', [], '') }));
  const doc = it => ({ id: it.id, packetId: key.packetId, t: 5, v: 1, T: { pref: it.T.preference, X: it.T.X, Y: it.T.Y }, A: { pref: it.A.preference, X: it.A.X, Y: it.A.Y } });
  const rows = ans.items.map(it => ({ path: 'answers/' + key.packetId + '/items/' + it.id, data: doc(it) }));
  rows.push({ path: 'answers/' + key.packetId, data: { packetId: key.packetId, role: 'piano teacher', t: 1 } });
  rows.push({ path: 'answers/otherpacket/items/i01', data: Object.assign(doc(ans.items[0]), { packetId: 'otherpacket' }) });
  const a = decode(key, ans), b = decode(key, dbToRatings(rows, key.packetId));
  const norm = o => JSON.stringify(Object.assign({}, o, { reviewer: null }));
  assert.equal(norm(b), norm(a));
  assert.equal(b.reviewer, 'piano teacher');
  const map = {}; rows.forEach(r => { map[r.path] = r.data; });
  assert.equal(norm(decode(key, dbToRatings(map, key.packetId))), norm(a), 'an object keyed by path reads the same');
  assert.equal(dbToRatings([], key.packetId).items.length, 0, 'no document, no answer');
  /* an older document of an item does not replace a newer one */
  const old = Object.assign({}, rows[0].data, { t: 1, T: Object.assign({}, rows[0].data.T, { pref: 'Y' }) }), nw = Object.assign({}, rows[0].data, { t: 9 });
  const r = dbToRatings([{ path: rows[0].path, data: nw }, { path: rows[0].path, data: old }], key.packetId);
  assert.equal(r.items[0].T.preference, rows[0].data.T.pref);
  const { spawnSync } = require('child_process');
  const dir = tmpDir('dbcli'); fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
  const run = spawnSync(process.execPath, [path.join(REPO, 'review/decode.js'), '--mode', 'h10', '--key', A.files.key, '--db', path.join(dir, 'rows.json')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Packet .* \(H-10\), 3 pieces, 3 with answers, reviewer role: piano teacher/);
});

test('ten pieces: the page is under 8 MB, built in processes in parallel, and a parallel build equals a sequential one', async () => {
  const names = Object.keys(FIXTURES).slice(0, 10);
  const dir = heardDir(names);
  const t0 = Date.now();
  const r = await buildPacket({ mode: 'h10', seed: SEED, heard: dir, out: path.join(tmpDir('ten'), 'p'), keyOut: path.join(tmpDir('tenk'), 'k'), jobs: 3 });
  const secs = (Date.now() - t0) / 1000;
  const size = fs.statSync(r.files.html).size;
  assert.equal(r.count, 10);
  assert.ok(size < 8 * 1048576, 'page ' + (size / 1048576).toFixed(2) + ' MB');
  const k = json(r.files.key);
  assert.equal(Object.values(k.items).filter(i => i.X === 'v2').length, 5, 'an even split: half the pieces show v2 as X');
  assert.deepEqual(leakScan(fs.readFileSync(r.files.html, 'utf8'), fs.readFileSync(r.files.manifest, 'utf8'), PAGE.drawingsOf(fs.readFileSync(r.files.html, 'utf8')), SEED), []);
  console.log('    ten fixture pieces: ' + (size / 1048576).toFixed(2) + ' MB, ' + secs.toFixed(1) + ' s with 3 processes');
  /* sequential = parallel for two of them */
  const two = ['know', 'notone'];
  const jobs = two.map(id => ({ id: id, title: 'Piece ' + id, heard: heardOf(id), excerpt: {} }));
  const par = await PACKET.buildItems(jobs, { jobs: 2 }), seq = await PACKET.buildItems(jobs, { jobs: 1 });
  const norm = x => JSON.stringify(x, (k, v) => k === 'ms' ? 0 : v);
  two.forEach(id => { assert.equal(par[id].ok, true); assert.equal(norm(par[id].result), norm(seq[id].result), id + ' differs between a worker and this process'); });
});

test('a worker that cannot build an item reports it (an error with its reason), it does not hang or crash the build', async () => {
  const r = await PACKET.buildItems([{ id: 'bad', title: 't', heard: { notes: [{ on: 0, off: 1, midi: 60 }] } }], { jobs: 2, timeoutMs: 120000 });
  assert.equal(r.bad.ok, false); assert.ok(r.bad.error.length > 0);
  const t = await PACKET.buildItems([{ id: 'slow', title: 't', heard: heardOf('know') }], { jobs: 2, timeoutMs: 1 });
  assert.equal(t.slow.ok, false); assert.match(t.slow.error, /timed out|worker/);
});
