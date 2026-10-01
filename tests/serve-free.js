/* A server for a browser suite on a FREE port: the other suites open 127.0.0.1:8777, which is often another session's server serving another tree.

     const { startServer } = require('./serve-free');
     const srv = await startServer();      // { url, port, close() } - this tree's server.js, NODE_ENV=production (nothing spawns on 8788)
     ... puppeteer against srv.url ...
     await srv.close();

   PPP_URL (a full URL of the app page) skips all of this and is used as it is, so a suite can be pointed at another build. The port is
   asked of the operating system (listen on 0), so nothing already listening is ever touched. */
'use strict';
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function healthy(port) {
  return new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: port, path: '/health', timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}

async function startServer(opts) {
  opts = opts || {};
  const page = 'Piano%20Coach%20App.dc.html';
  if (process.env.PPP_URL) {
    return { url: process.env.PPP_URL, port: null, close: async () => {}, external: true };
  }
  const root = opts.root || path.resolve(__dirname, '..');
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) }, opts.env || {})
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (exited) throw new Error('server.js exited before it answered on port ' + port);
    if (await healthy(port)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (!(await healthy(port))) { child.kill(); throw new Error('server.js did not answer /health on port ' + port); }
  return {
    url: 'http://127.0.0.1:' + port + '/' + page, port: port, external: false,
    close: () => new Promise(resolve => { if (exited) return resolve(); child.on('exit', () => resolve()); child.kill(); })
  };
}

module.exports = { startServer, freePort };
