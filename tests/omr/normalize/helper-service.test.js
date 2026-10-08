'use strict';
/* omr-service.js (G12-1): the service runs in production too (render.yaml), so the new `movements` must never be a way to break it.
   It is started as a child process from a COPY of omr-service.js in a temp folder (so what it can `require` is decided here), twice: with omr/helper-output.js beside it and
   without. Both must start and answer /health. Where an executable stand-in for Audiveris can be written (a POSIX shell script; not on Windows, where execFile cannot run one),
   a real /omr request is made too: `musicxml` is the newest file in both, `movements` is every file in movement order with the module and that one file without it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const dirs = [];
const kids = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-service-')); dirs.push(d); return d; };
test.after(() => {
  kids.forEach(k => { try { k.kill(); } catch (e) { void e; } });
  dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } });
});

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

/* a folder with a copy of the service, with or without omr/helper-output.js */
function installService(withModule) {
  const dir = tmp();
  fs.copyFileSync(path.join(REPO, 'omr-service.js'), path.join(dir, 'omr-service.js'));
  if (withModule) {
    fs.mkdirSync(path.join(dir, 'omr'));
    fs.copyFileSync(path.join(REPO, 'omr', 'helper-output.js'), path.join(dir, 'omr', 'helper-output.js'));
  }
  return dir;
}
async function start(dir, extra) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(dir, 'omr-service.js'), '--port', String(port)].concat(extra || []), {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: Object.assign({}, process.env, { PPP_AUDIVERIS: '', PPP_PDFTOMUSIC: '' })
  });
  kids.push(child);
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the service did not start: ' + out)), 20000);
    const seen = d => { out += d; if (/PPP OMR service on/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error('the service exited (' + code + '): ' + out)); });
  });
  return { port, child, log: () => out };
}
function request(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch (e) { resolve({ status: res.statusCode, text }); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

test('the service starts and answers /health with omr/helper-output.js beside it', async () => {
  const s = await start(installService(true));
  const r = await request(s.port, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.doesNotMatch(s.log(), /helper-output/);
});

test('the service starts and answers /health when omr/helper-output.js is missing: the new file can never take the service down', async () => {
  const s = await start(installService(false));
  const r = await request(s.port, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.service, 'ppp-local');
  assert.equal(s.child.exitCode, null, 'still running');
});

test('the service starts when omr/helper-output.js is there but broken (a syntax error)', async () => {
  const dir = installService(true);
  fs.writeFileSync(path.join(dir, 'omr', 'helper-output.js'), 'module.exports = {{{ this is not javascript');
  const s = await start(dir);
  assert.equal((await request(s.port, 'GET', '/health')).status, 200);
});

/* ---- a real /omr request, with a stand-in for Audiveris (POSIX only: execFile cannot run a script on Windows) ---- */
function crc(buf) { return zlib.crc32(buf) >>> 0; }
/* a stored (uncompressed) zip of one file: what the helper's own reader (the central directory) reads */
function mxl(xml) {
  const name = Buffer.from('score.xml'), data = Buffer.from(xml, 'utf8');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const head = Buffer.concat([local, name, data]);
  const cd = Buffer.concat([central, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(head.length, 16);
  return Buffer.concat([head, cd, end]);
}
const MV1 = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"/></part></score-partwise>';
const MV2 = MV1.replace('number="1"', 'number="1"/><measure number="2"');
const POSIX = process.platform !== 'win32';

async function omrRequest(withModule) {
  const dir = installService(withModule);
  const fake = path.join(dir, 'fake-audiveris.sh');
  fs.writeFileSync(path.join(dir, 'page.mvt1.mxl'), mxl(MV1));
  fs.writeFileSync(path.join(dir, 'page.mvt2.mxl'), mxl(MV2));
  /* writes mvt2 first and mvt1 a second later: the NEWEST file is mvt1, the old helper's answer; the movement order is by number, not by time */
  fs.writeFileSync(fake, '#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-output" ]; then out="$2"; shift; fi; shift; done\ncp "' + path.join(dir, 'page.mvt2.mxl') + '" "$out/"\nsleep 1\ncp "' + path.join(dir, 'page.mvt1.mxl') + '" "$out/"\n', { mode: 0o755 });
  const s = await start(dir, ['--audiveris', fake]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
  return request(s.port, 'POST', '/omr', { pages: [png] });
}

test('/omr with the module: `musicxml` is the newest file as it always was, `movements` is every file in movement order', { skip: !POSIX && 'a shell script cannot stand in for Audiveris on Windows (it runs in the gate, on Linux)' }, async () => {
  const r = await omrRequest(true);
  assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.musicxml, [MV1], 'the old field: the newest file (mvt1 was written last)');
  assert.deepEqual(r.json.movements, [[MV1, MV2]], 'the new field: movement 1, then movement 2, whatever the file times');
});

test('/omr without the module: the same `musicxml`, and `movements` is that one file', { skip: !POSIX && 'a shell script cannot stand in for Audiveris on Windows (it runs in the gate, on Linux)' }, async () => {
  const r = await omrRequest(false);
  assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.musicxml, [MV1], 'untouched by the missing module');
  assert.deepEqual(r.json.movements, [[MV1]]);
});
