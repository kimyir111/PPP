/* G10a-5 (H-10): the collector (review/h10/collect.js) driving the real page against a fake audio endpoint: a piece whose model is stubbed is collected, a refused
   download and a piece that is too long are REPORTED (never silently dropped), a second run skips what exists, nothing is written outside --out, and the only
   request to "production" is the read-only GET of /api/youtube-audio (here a local fake: the real endpoint is never contacted by a test). Skipped if puppeteer
   cannot be found. The real six-minute model is not run here; it is run by hand (docs/GOALS/G10 section 27). */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, heardOf, tmpDir } = require('./h10-helpers.js');
const C = require(path.join(REPO, 'review/h10/collect.js'));

let puppeteerOk = true;
try { require('puppeteer'); } catch (e) { try { require('D:/PPP/node_modules/puppeteer'); } catch (e2) { puppeteerOk = false; } }
const skip = puppeteerOk ? false : 'puppeteer is not installed';

const n = 800, WAV = Buffer.alloc(44 + n);
WAV.write('RIFF', 0); WAV.writeUInt32LE(36 + n, 4); WAV.write('WAVE', 8); WAV.write('fmt ', 12); WAV.writeUInt32LE(16, 16); WAV.writeUInt16LE(1, 20); WAV.writeUInt16LE(1, 22);
WAV.writeUInt32LE(8000, 24); WAV.writeUInt32LE(8000, 28); WAV.writeUInt16LE(1, 32); WAV.writeUInt16LE(8, 34); WAV.write('data', 36); WAV.writeUInt32LE(n, 40); WAV.fill(128, 44);

let server, base; const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.method + ' ' + req.url);
    if (/bad/.test(req.url)) { res.writeHead(502, { 'content-type': 'application/json' }); return res.end('{"error":"download-failed"}'); }
    res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(WAV);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { if (server) server.close(); });

const gitState = () => String(spawnSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout);
const quiet = () => {};

test('input is checked before any browser starts: ids, duplicates, a link that is not YouTube, no items', async () => {
  const out = tmpDir('colbad');
  await assert.rejects(C.collect([{ id: 'a b', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }], { out: out, log: quiet }), /usable id/);
  await assert.rejects(C.collect([{ id: 'a', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }, { id: 'a', url: 'https://youtu.be/bbbbbbbbbbb' }], { out: out, log: quiet }), /two items with the id/);
  await assert.rejects(C.collect([{ id: 'a', url: 'https://example.com/x' }], { out: out, log: quiet }), /no YouTube link/);
  await assert.rejects(C.collect([], { out: out, log: quiet }), /no items/);
  await assert.rejects(C.collect([{ id: 'a', url: 'https://youtu.be/bbbbbbbbbbb' }], { log: quiet }), /--out is required/);
  assert.deepEqual(fs.readdirSync(out), [], 'nothing was written');
});

test('collected, refused and too long are each reported; a second run skips what exists; only --out is written; production is only ever asked for audio, by GET', { skip }, async () => {
  const before = gitState();
  const stub = tmpDir('colstub'), out = tmpDir('colout');
  const heard = heardOf('nearer');
  fs.writeFileSync(path.join(stub, 'ok1.json'), JSON.stringify(heard));
  const items = [
    { id: 'ok1', url: 'https://www.youtube.com/watch?v=okokokokok1', excerpt: { bars: 8 }, inputClass: 'CLEAN_INPUT' },
    { id: 'bad1', url: 'https://www.youtube.com/watch?v=badbadbad01' },
    { id: 'long1', url: 'https://www.youtube.com/watch?v=longlonglo1' }
  ];
  /* the stub model for ok1 (no network at all); a real flow with the fake audio endpoint for the other two, with a limit the 0.1 s audio exceeds */
  const r1 = await C.collect(items.slice(0, 1), { out: out, parallel: 1, stubDir: stub, log: quiet });
  const r2 = await C.collect(items.slice(1), { out: out, parallel: 2, audioBase: base, maxMinutes: 0.001, log: quiet });
  assert.deepEqual(r1.counts, { ok: 1 });
  assert.deepEqual(r2.counts.refused + r2.counts['too-long'], 2);
  const st = JSON.parse(fs.readFileSync(path.join(out, 'collect-status.json'), 'utf8')).items;
  assert.equal(st.ok1.status, 'ok'); assert.equal(st.ok1.stubbed, true); assert.equal(st.ok1.notes, heard.notes.length); assert.equal(st.ok1.model.engine, 'onsets-and-frames'); assert.ok(st.ok1.seconds.total >= 0);
  assert.equal(st.bad1.status, 'refused'); assert.match(st.bad1.error, /could not get the sound/); assert.equal(st.bad1.audioStatus, 502);
  assert.equal(st.long1.status, 'too-long'); assert.match(st.long1.error, /the limit is 0\.001/); assert.equal(st.long1.audioSeconds, 0.1);
  assert.equal(st.long1.transcribeStartedAt, undefined, 'no stray timer in the status');
  /* the heard notes are the ones the model gave, in the app's own shape, and only for the collected piece */
  const got = JSON.parse(fs.readFileSync(path.join(out, 'ok1.json'), 'utf8'));
  assert.deepEqual(got.notes, heard.notes); assert.equal(got.engine, 'onsets-and-frames');
  assert.deepEqual(fs.readdirSync(out).sort(), ['collect-status.json', 'items.json', 'ok1.json'], 'only --out, no .part files, no file for a piece that was not collected');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'items.json'), 'utf8')).map(i => i.id), ['ok1', 'bad1', 'long1'], 'items.json holds the earlier run\'s items and the later run\'s');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'items.json'), 'utf8'))[0].inputClass, 'CLEAN_INPUT', 'extra fields of an item are kept for the builder');
  /* production (here the fake): GET /api/youtube-audio only */
  assert.ok(seen.length >= 2 && seen.every(s => /^GET \/api\/youtube-audio\?url=/.test(s)), 'only GETs of /api/youtube-audio: ' + seen.join(' | '));
  assert.equal(st.bad1.blockedRequests, undefined, 'the page made no non-GET request outside this machine');
  /* resumable: a second run of all three skips the one that exists and does not start a browser for it */
  const t0 = Date.now();
  const r3 = await C.collect([items[0]], { out: out, parallel: 1, stubDir: stub, log: quiet });
  assert.ok(Date.now() - t0 < 3000, 'nothing was collected again: ' + (Date.now() - t0) + ' ms');
  assert.deepEqual(r3.collected, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'collect-status.json'), 'utf8')).items.ok1.skipped, 'already collected');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'collect-status.json'), 'utf8')).items.bad1.status, 'refused', 'the others\' reports are kept');
  /* the repository is untouched */
  assert.equal(gitState(), before, 'no file appeared in the repository');
});
