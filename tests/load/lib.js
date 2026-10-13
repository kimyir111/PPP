'use strict';
/* G13-4 test helpers (Node only): start server.js on a free port, from this tree or from a small tree of copies, and make requests that report everything. */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* PPP_LOAD_ROOT: run the tests against a copy of the tree (tests/load/mutants.js plants a defect in a copy and expects the tests to notice) */
const REPO = process.env.PPP_LOAD_ROOT ? path.resolve(process.env.PPP_LOAD_ROOT) : path.resolve(__dirname, '..', '..');

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
/* PPP_PORT_RANGE=9760-9799 keeps a machine that reserves a band of ports for its suites inside it (the same switch as tests/serve-free.js); without it the operating system chooses */
async function freePort() {
  const m = /^(\d+)-(\d+)$/.exec(process.env.PPP_PORT_RANGE || '');
  if (!m) return listenOn(0);
  for (let p = +m[1]; p <= +m[2]; p++) { try { return await listenOn(p); } catch (e) { /* taken: the next one */ } }
  throw new Error('no free port in ' + process.env.PPP_PORT_RANGE);
}

/* a running server.js. `root` is the folder holding server.js (default: this tree). */
async function boot(root, env) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-load-'));
  const child = spawn(process.execPath, [path.join(root || REPO, 'server.js')], {
    cwd: root || REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '', PPP_DATA_DIR: dir, PPP_HSTS: '' }, env || {})
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 30000);
    const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', seen);
    child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
  });
  return { port, log: () => out, close: () => { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ } } };
}

/* one request; the body comes back as it was on the wire (raw) and, if the answer is gzip, also gunzipped */
function request(port, url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: url, method: opts.method || 'GET', headers: opts.headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let body = raw;
        if (/gzip/.test(res.headers['content-encoding'] || '')) { try { body = zlib.gunzipSync(raw); } catch (e) { body = null; } }
        resolve({ status: res.statusCode, headers: res.headers, raw, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/* the hash the server gives a file: 12 hex of the sha256 of the text with CRLF as LF (binary: of the bytes). Written here again, not taken from static-assets.js. */
function hashOf(buf, binary) {
  const body = binary ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
}

/* a small tree that server.js runs in: the server and its modules, a page that names a script and a catalog, and whatever `files` adds */
const SERVER_FILES = ['server.js', 'static-allow.js', 'static-assets.js', 'share-guest.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'signup-limit.js', 'server-stats.js'];
function smallTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-tree-'));
  for (const f of SERVER_FILES) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  for (const rel of Object.keys(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel]);
  }
  return { dir, write: (rel, content) => { const abs = path.join(dir, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); }, remove: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* stays */ } } };
}

module.exports = { REPO, boot, request, hashOf, smallTree, SERVER_FILES };
