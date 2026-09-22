'use strict';
/* The app's server hands out the library the page loads (G01 §15.5, A44): scoregraph/ is not blocked, the
   Docker image keeps it, and a running server answers GET /scoregraph/<file>.js with the file. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { REPO } = require('./helpers.js');

const FILES = fs.readdirSync(path.join(REPO, 'scoregraph')).filter(f => f.endsWith('.js')).sort();

test('server.js does not block scoregraph/ and .dockerignore keeps it in the image (A44)', () => {
  const server = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const blocked = /const BLOCKED = new Set\(\[([^\]]*)\]\)/.exec(server);
  assert.ok(blocked, 'the BLOCKED set is where it was');
  assert.ok(!/scoregraph/.test(blocked[1]), blocked[1]);
  const ignore = fs.readFileSync(path.join(REPO, '.dockerignore'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  ignore.forEach(rule => assert.ok(!/^(\*\*\/)?scoregraph|^\*$|^\*\*$/.test(rule), '.dockerignore rule ' + rule));
  assert.match(fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8'), /^COPY \. \.$/m);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function get(port, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: port, path: url }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

test('a running server answers GET /scoregraph/<file>.js with the file (A44)', async () => {
  const port = await freePort();
  /* production: the local OMR helper is not started beside it */
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO, env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '' }),
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  try {
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 20000);
      const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', seen);
      child.stderr.on('data', d => { out += d; });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
    });
    for (const f of FILES) {
      const r = await get(port, '/scoregraph/' + f + '?v=9');
      assert.equal(r.status, 200, f);
      assert.match(r.type, /javascript/, f);
      assert.equal(r.body, fs.readFileSync(path.join(REPO, 'scoregraph', f), 'utf8'), f);
    }
    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<script src="\.\/scoregraph\/index\.js\?v=\d+"><\/script>\s*<script src="\.\/audio-score\.js\?v=\d+"><\/script>/);
  } finally {
    child.kill();
  }
});
