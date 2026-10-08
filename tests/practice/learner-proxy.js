/* G11b-1: a small proxy in front of this tree's server that rewrites chosen served files on their way to the browser (no file is touched).
   Two users: tests/practice/learner-mutants.js (one rule of the page or of practice/runlog.js broken at a time) and the legacy recorder of
   tests/learner-log.test.js (--record: the page as it was at a commit, to write the golden dump of the legacy aggregates from the page that
   produced them).

     const P = await fileProxy('http://127.0.0.1:8801', { edits: [{ file: 'Piano Coach App.dc.html', from: 'a', to: 'b' }], replace: { 'Piano Coach App.dc.html': text } });
     P.port, P.url(pageUrl), P.counts() (how many times each edit's `from` was found, per edit), P.close()

   An edit applies only when its `from` is in the file exactly once (a rule that no longer matches must be noticed, not pass as a mutant nobody
   killed): counts() says how many times each was found. The port comes from LL_PORT_RANGE ("9220-9249"; default: any free port). */
'use strict';
const http = require('http');

const norm = s => s.split('\r\n').join('\n');

function listen(server) {
  const range = /^(\d+)-(\d+)$/.exec(process.env.LL_PORT_RANGE || '');
  return new Promise((resolve, reject) => {
    if (!range) { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); return; }
    let p = +range[1];
    const hi = +range[2];
    const tryNext = () => {
      if (p > hi) { reject(new Error('no free port in ' + process.env.LL_PORT_RANGE)); return; }
      const port = p++;
      const onError = e => { if (e && e.code === 'EADDRINUSE') tryNext(); else reject(e); };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', onError); resolve(port); });
    };
    tryNext();
  });
}

function fileProxy(upstream, opts) {
  opts = opts || {};
  const edits = opts.edits || [];
  const replace = opts.replace || {};
  const u = new URL(upstream);
  let counts = edits.map(() => null);
  const server = http.createServer((req, res) => {
    const headers = Object.assign({}, req.headers, { host: u.host });
    delete headers['accept-encoding'];
    const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const mine = edits.map((e, i) => [e, i]).filter(([e]) => e.file === path);
    const swap = Object.prototype.hasOwnProperty.call(replace, path);
    const up = http.request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: headers }, ur => {
      if (!mine.length && !swap) { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); return; }
      const chunks = [];
      ur.on('data', c => chunks.push(c));
      ur.on('end', () => {
        let text = norm(Buffer.concat(chunks).toString('utf8'));
        if (swap) text = norm(replace[path]);
        mine.forEach(([e, i]) => { counts[i] = text.split(e.from).length - 1; });
        if (mine.every(([, i]) => counts[i] === 1)) mine.forEach(([e]) => { text = text.replace(e.from, () => e.to); });
        const body = Buffer.from(text, 'utf8');
        const h = Object.assign({}, ur.headers, { 'content-length': body.length });
        delete h['content-encoding'];
        res.writeHead(ur.statusCode, h);
        res.end(body);
      });
    });
    up.on('error', e => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  return listen(server).then(port => ({
    port,
    counts: () => counts.slice(),
    url: pageUrl => { const p = new URL(pageUrl); p.port = String(port); return p.href; },
    close: () => new Promise(r => server.close(() => r()))
  }));
}

module.exports = { fileProxy };
