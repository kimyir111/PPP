/* G9c: whole packets built from real corpus pieces - determinism, the leak scan, identical X/Y metadata, the key, decode round trip,
   no external URLs, and that X and Y of an item are the same piece at the same target. (Each arrangement is really computed once
   and cached for the process; the four pieces are small.) */
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, ITEMS, CACHE, tmpDir, readAll } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const { decode } = require(path.join(REPO, 'review/decode.js'));

const SEED = 'test-secret-seed-alpha';
const build = (mode, seed, items, tag) => {
  const out = tmpDir(tag);
  return buildPacket({ mode: mode, seed: seed, out: path.join(out, 'packet'), items: items || ITEMS, cache: CACHE });
};
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let A, A9; /* an H-8 and an H-9 packet built once for the read-only checks */
before(async () => { A = await build('h8', SEED, ITEMS, 'a'); A9 = await build('h9', SEED, ITEMS.slice(0, 2), 'a9'); });

test('determinism: the same seed and items give a byte-identical packet and key, whatever order the items are listed in', async () => {
  const b = await build('h8', SEED, ITEMS.slice().reverse(), 'b');
  const c = await build('h8', SEED, ITEMS, 'c');
  const ra = readAll(A.outDir), rb = readAll(b.outDir), rc = readAll(c.outDir);
  assert.deepEqual(Object.keys(ra), ['index.html', 'manifest.json'], 'the packet is exactly two files');
  Object.keys(ra).forEach(f => { assert.ok(ra[f].equals(rb[f]), f + ' differs when the item order differs'); assert.ok(ra[f].equals(rc[f]), f + ' differs between two builds'); });
  assert.ok(fs.readFileSync(A.files.key).equals(fs.readFileSync(b.files.key)), 'the key is byte-identical too');
});

test('a different seed changes the assignment or the order (and the key records the seed it used)', async () => {
  const d = await build('h8', 'test-secret-seed-beta', ITEMS, 'd');
  const ka = json(A.files.key), kd = json(d.files.key);
  assert.equal(ka.seed, SEED); assert.equal(kd.seed, 'test-secret-seed-beta');
  const sig = k => Object.keys(k.items).map(id => id + ':' + k.items[id].file + ':' + k.items[id].X).join('|');
  assert.notEqual(sig(ka), sig(kd));
  assert.notEqual(A.packetId, d.packetId);
});

test('leak scan (H-8 and H-9 packets): no file in the packet contains a word that names an arranger or a step of how an arrangement was made, nor the seed', () => {
  const words = ['g9', 'legacy', 'scorearranger', 'arrange_score', 'audio-score', 'selected', 'repaired', 'repair', 'candidate', 'critic', 'realiz', 'best-of', 'g8', 'engine', 'planner', 'waltz', 'ballad', 'pattern'];
  [A, A9].forEach(P => scanPacket(P, words));
});

function scanPacket(P, words) {
  const files = readAll(P.outDir);
  Object.keys(files).forEach(f => {
    const text = files[f].toString('utf8').toLowerCase();
    words.forEach(w => {
      assert.ok(text.indexOf(w) < 0, f + ' contains "' + w + '" at ' + text.indexOf(w) + ': ' + JSON.stringify(text.slice(Math.max(0, text.indexOf(w) - 30), text.indexOf(w) + 30)));
    });
    assert.ok(text.indexOf(SEED.toLowerCase()) < 0, f + ' contains the seed');
    assert.ok(text.indexOf('seed') < 0, f + ' mentions a seed');
  });
}

test('the key (and the seed) are outside the packet directory and are not reachable from it', () => {
  assert.ok(path.relative(A.outDir, A.keyDir).startsWith('..'), 'the key directory is not inside the packet directory');
  assert.ok(path.relative(A.keyDir, A.outDir).startsWith('..'), 'the packet directory is not inside the key directory');
  assert.ok(fs.existsSync(A.files.key));
  assert.ok(json(A.files.key).items && json(A.files.key).seed);
  assert.equal(fs.existsSync(path.join(A.outDir, 'key.json')), false);
});

test('the reviewer manifest gives X and Y the same fields, and states neither seed, rule nor assignment', () => {
  const m = json(A.files.manifest);
  assert.equal(m.items.length, ITEMS.length);
  m.items.forEach(it => {
    assert.equal(it.versions.length, 2);
    assert.deepEqual(Object.keys(it.versions[0]), Object.keys(it.versions[1]), 'X and Y carry the same field names');
    assert.deepEqual(it.versions[0], { label: 'X', bars: it.piece.bars });
    assert.deepEqual(it.versions[1], { label: 'Y', bars: it.piece.bars });
  });
  const text = JSON.stringify(m).toLowerCase();
  ['seed', 'rule', 'assign', 'hmac', 'sha', 'key'].forEach(w => assert.ok(text.indexOf(w) < 0, 'manifest mentions ' + w));
  /* item order in the manifest is the shown order, which is not the order the items were given in */
  assert.equal(m.items.map(i => i.id).join(','), 'i01,i02,i03,i04');
});

test('X and Y are drawn by one path: identical root attributes, no data-* attributes, no engine-only marks', () => {
  const html = fs.readFileSync(A.files.html, 'utf8');
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g);
  assert.equal(svgs.length, ITEMS.length * 2);
  svgs.forEach(s => {
    assert.ok(!/ data-[a-z]/.test(s), 'an svg still has a data-* attribute');
    assert.ok(!/ppp-fingering|ppp-tempo|ppp-dynamic|ppp-pedal|<title|<desc/.test(s), 'an svg carries a mark or text an engine may have added');
    const root = s.match(/^<svg([^>]*)>/)[1];
    assert.deepEqual(root.match(/ ([A-Za-z:]+)=/g).map(x => x.trim()), ['xmlns=', 'class=', 'viewBox=', 'fill=']);
    assert.ok(!/width=|height=/.test(root), 'no pixel size on the root');
  });
  /* per item, the two drawings' root attribute names are the same, and glyph ids are prefixed by item and label only */
  for (let i = 0; i < svgs.length; i += 2) {
    const names = s => s.match(/^<svg([^>]*)>/)[1].match(/ ([A-Za-z:]+)=/g).join('');
    assert.equal(names(svgs[i]), names(svgs[i + 1]));
    const ids = s => [...new Set((s.match(/ id="([^"]+)"/g) || []).map(x => x.replace(/^ id="(i\d\d[XY])-.*$/, '$1')))];
    assert.equal(ids(svgs[i]).length <= 1 && ids(svgs[i + 1]).length <= 1, true);
  }
  /* the page data has the same shape for X and Y: [startQ, durQ, midi] triples */
  const data = JSON.parse(html.match(/<script id="packet-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  Object.keys(data.items).forEach(id => {
    assert.deepEqual(Object.keys(data.items[id]), ['tempo', 'totalQ', 'X', 'Y']);
    ['X', 'Y'].forEach(side => data.items[id][side].forEach(n => { assert.equal(n.length, 3); n.forEach(v => assert.ok(Number.isFinite(v))); }));
  });
});

test('the page is self-contained: no external URL, no request, no import', () => {
  const html = fs.readFileSync(A.files.html, 'utf8');
  const noNs = html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  assert.ok(!/https?:|\/\/[a-z0-9.-]+\.[a-z]{2,}|ftp:|wss?:/i.test(noNs), 'a URL is in the page: ' + (noNs.match(/https?:[^"' )]*|\/\/[a-z0-9.-]+\.[a-z]{2,}/i) || [''])[0]);
  assert.ok(!/<link\b|<img\b|<iframe\b|<script[^>]*\ssrc=|<audio\b|<video\b|<embed\b|<object\b|@import|(^|[^A-Za-z])url\(|fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|import\(/i.test(html.replace(/createObjectURL|revokeObjectURL/g, '')), 'the page loads or sends something');
  assert.ok(!/(href|src)="(?!#)/.test(noNs.replace(/href="#[^"]*"/g, '')), 'a non-fragment href or src');
});

test('every item is one piece at one target: same bars, same length, both sides are notes of that piece', () => {
  const m = json(A.files.manifest), k = json(A.files.key);
  const data = JSON.parse(fs.readFileSync(A.files.html, 'utf8').match(/<script id="packet-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  m.items.forEach(it => {
    const ki = k.items[it.id];
    assert.equal(ki.file, it.piece.file); assert.equal(ki.targetLevel, it.targetLevel); assert.equal(ki.handProfile, it.handProfile);
    assert.deepEqual([ki.X, ki.Y].sort(), ['g9', 'legacy']);
    const d = data.items[it.id];
    ['X', 'Y'].forEach(side => {
      assert.ok(d[side].length > 0);
      const last = Math.max.apply(null, d[side].map(n => n[0]));
      assert.ok(last < d.totalQ, side + ' has a note that starts after the piece ends');
    });
  });
});

test('the legacy arm is the ScoreArranger level whose measured G6 position is closest to the target (re-derived independently)', async () => {
  const path2 = path.join(REPO, 'review/lib/arrange.js');
  const { legacyNotesAllLevels, LEGACY_LEVELS } = require(path2);
  const L = require(path.join(REPO, 'realize/tools/legacy.js'));
  const M = require(path.join(REPO, 'critics/metrics.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  const k = json(A.files.key);
  for (const id of Object.keys(k.items)) {
    const ki = k.items[id];
    const g = await H.graphOf(ki.file);
    const ws = L.wireScoreOf(g, path.basename(ki.file));
    const all = legacyNotesAllLevels(ws);
    const lv = {};
    LEGACY_LEVELS.forEach(name => { const p = L.graphFromLegacyNotes(ws.measures, all.notes[name], ws.tempo, 'x'); lv[name] = M.levelOfGraph(p.graph); });
    const best = LEGACY_LEVELS.slice().sort((a, b) => Math.abs(lv[a] - ki.targetLevel) - Math.abs(lv[b] - ki.targetLevel) || LEGACY_LEVELS.indexOf(a) - LEGACY_LEVELS.indexOf(b))[0];
    assert.equal(ki.legacy.level, best, id + ': the recorded legacy level is not the closest one');
    assert.equal(ki.legacy.engine, 'ScoreArranger');
    assert.ok(Math.abs(ki.legacy.levelDistanceToTarget - Math.abs(lv[best] - ki.targetLevel)) < 1e-9);
  }
});

test('decode round trip: ratings written in X/Y terms come back attributed to the right arm', async () => {
  const k = json(A.files.key);
  /* a reviewer who always prefers G9, passes G9 and fails the legacy arm, and tags only the legacy arm */
  const ratings = { format: 'ppp-review-ratings/1', packetId: A.packetId, mode: 'h8', reviewer: 'test', exportedAt: 'x',
    ratings: Object.keys(k.items).map(id => {
      const g9x = k.items[id].X === 'g9';
      const good = { pass: true, issues: [], text: '' }, bad = { pass: false, issues: ['too-hard', 'thin-muddy'], text: 'bar 3' };
      return { id: id, preference: g9x ? 'X' : 'Y', X: g9x ? good : bad, Y: g9x ? bad : good };
    }) };
  const o = decode(k, ratings);
  assert.equal(o.preference.g9, ITEMS.length); assert.equal(o.preference.legacy, 0);
  assert.equal(o.pass.g9.pass, ITEMS.length); assert.equal(o.pass.legacy.fail, ITEMS.length);
  assert.deepEqual(o.issues.legacy, { 'too-hard': ITEMS.length, 'thin-muddy': ITEMS.length }); assert.deepEqual(o.issues.g9, {});
  assert.equal(o.notes.legacy.length, ITEMS.length); assert.equal(o.notes.g9.length, 0);
  assert.equal(o.paired.onlyG9Passes, ITEMS.length);
  o.byItem.forEach(r => assert.equal(r.g9.pass, true));
  /* the opposite reviewer flips it */
  const flipped = JSON.parse(JSON.stringify(ratings));
  flipped.ratings.forEach(r => { r.preference = r.preference === 'X' ? 'Y' : 'X'; });
  assert.equal(decode(k, flipped).preference.legacy, ITEMS.length);
  /* "no difference" and unrated items are counted, not dropped */
  const partial = JSON.parse(JSON.stringify(ratings));
  partial.ratings[0].preference = 'same'; partial.ratings.pop();
  const p = decode(k, partial);
  assert.equal(p.preference.noDifference, 1); assert.equal(p.preference.unrated, 1); assert.equal(p.items, ITEMS.length);
});

test('decode refuses a key and ratings that are not the same packet or mode, and unknown or repeated items', () => {
  const k = json(A.files.key);
  const ok = { format: 'ppp-review-ratings/1', packetId: A.packetId, mode: 'h8', ratings: [] };
  assert.doesNotThrow(() => decode(k, ok));
  assert.throws(() => decode(k, Object.assign({}, ok, { packetId: 'deadbeef0000' })), /packet/);
  assert.throws(() => decode(k, Object.assign({}, ok, { mode: 'h9' })), /mode/);
  assert.throws(() => decode(k, Object.assign({}, ok, { ratings: [{ id: 'i99' }] })), /does not have/);
  assert.throws(() => decode(k, Object.assign({}, ok, { ratings: [{ id: 'i01' }, { id: 'i01' }] })), /twice/);
  assert.throws(() => decode(k, { format: 'nope' }), /ratings file/);
});

test('a H-9 packet builds too: pass/fail form, one level per item', async () => {
  const h9 = await build('h9', 'test-secret-seed-gamma', ITEMS.slice(0, 2), 'h9');
  const html = fs.readFileSync(h9.files.html, 'utf8');
  assert.ok(/name="pass-i01-X"/.test(html) && /name="pass-i01-Y"/.test(html));
  assert.ok(!/data-issue="too-hard"/.test(html), 'the H-9 form has no issue checkboxes');
  const h8 = fs.readFileSync(A.files.html, 'utf8');
  assert.ok(/data-issue="too-hard"/.test(h8) && /data-issue="thin-muddy"/.test(h8) && !/<input type="radio" name="pass-/.test(h8));
  assert.equal(json(h9.files.manifest).review, 'H-9');
});
