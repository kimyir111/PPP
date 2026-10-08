/* G11a-0: what the practice probes share. A free-port server of this tree, a headless page that has booted the app, the catalogue list (with
   the licence-quarantined files marked), and a small proxy that rewrites ONE rule of the app's source on its way to the browser, which is how
   the mutation checks break the matcher without touching a file (tests/practice/mutants.js).

   Needs puppeteer (npm ci; on a developer's machine NODE_PATH may point at another tree's node_modules). */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer } = require('../serve-free');
const { preparePage } = require('../boot');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'Piano Coach App.dc.html';
const CANON_SRC = fs.readFileSync(path.join(__dirname, 'canon.js'), 'utf8');

function puppeteer() { return require('puppeteer'); }

/* The pieces the probes read: the catalogue's MusicXML files and two sets of committed fixtures (the engraving E fixtures, which carry
   pedal changes, 8va, graces, jumps, arpeggios; and the ScoreGraph reader's fixtures, some of which are meant to be refused), sorted, as repository
   paths. The catalogue is served by the app's own server, a fixture is read here and handed to the page as text (`text`).
   `quarantined` is the licence rule of the benchmark's provenance file: such a score may be used to measure but its per-file output is never
   published (only counts and one digest of the lot are). */
const FIXTURE_SETS = [['engrave-e', 'tests/engrave/fixtures/e'], ['scoregraph-xml', 'tests/scoregraph/fixtures/xml']];
function corpus() {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mxl|musicxml)$/.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  });
  walk(path.join(ROOT, 'catalog'));
  out.sort();
  const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'bench', 'corpus', 'provenance.json'), 'utf8'));
  const quarantined = new Set(prov.entries.filter(e => e.quarantine_reason).map(e => e.path));
  const list = out.map(p => ({ path: p, set: 'catalog', quarantined: quarantined.has(p) }));
  FIXTURE_SETS.forEach(([set, dir]) => {
    fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.musicxml$/.test(f)).sort().forEach(f => {
      list.push({ path: dir + '/' + f, set: set, quarantined: false, text: fs.readFileSync(path.join(ROOT, dir, f), 'utf8') });
    });
  });
  return list;
}

/* A server of this tree on a free port (or the one PPP_URL names), and the page URL. */
async function serve() {
  const srv = await startServer();
  return srv;
}

/* A page on `url` that has booted the app (window.PPP.app exists) and carries the canon functions as window.PPPPracticeCanon.
   opts.cpu       CPU throttle rate (1 = none)
   opts.fakeMidi  a function installed before the page's scripts (evaluateOnNewDocument), e.g. a fake Web MIDI input
   opts.width/height  viewport */
async function openApp(url, opts) {
  opts = opts || {};
  const browser = await puppeteer().launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width || 1280, height: opts.height || 860 });
  await preparePage(page);
  if (opts.fakeMidi) await page.evaluateOnNewDocument(opts.fakeMidi);
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore && window.PPPScoreGraph, { timeout: 60000 });
  await page.addScriptTag({ content: CANON_SRC });
  let cdp = null;
  if (opts.cpu && opts.cpu !== 1) {
    cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu });
  }
  return { browser, page, cdp, problems, close: () => browser.close() };
}

/* A proxy in front of `upstream` (an http://host:port origin) that applies `edits` ([[from, to], ...], each `from` exactly once) to the app's
   page and passes everything else through. Returns { port, url(pageUrl), close }. An edit that does not apply, or applies twice, is an error:
   a mutation row that no longer matches the source must be noticed, not pass as a mutant nothing killed. */
function mutatingProxy(upstream, edits) {
  const u = new URL(upstream);
  let applied = null;
  const server = http.createServer((req, res) => {
    const headers = Object.assign({}, req.headers, { host: u.host });
    delete headers['accept-encoding'];
    const up = http.request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: headers }, ur => {
      const isPage = decodeURIComponent(req.url.split('?')[0]).endsWith('/' + PAGE) && (ur.headers['content-type'] || '').includes('text/html');
      if (!isPage) { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); return; }
      const chunks = [];
      ur.on('data', c => chunks.push(c));
      ur.on('end', () => {
        let text = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n');   /* one line end whatever the checkout: a multi-line `from` matches on every machine */
        const counts = edits.map(([from]) => text.split(from).length - 1);
        applied = counts;
        if (counts.every(c => c === 1)) edits.forEach(([from, to]) => { text = text.replace(from, () => to); });
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
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        counts: () => applied,
        url: pageUrl => { const p = new URL(pageUrl); p.port = String(port); return p.href; },
        close: () => new Promise(r => server.close(() => r()))
      });
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const quantile = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

module.exports = { ROOT, PAGE, CANON_SRC, corpus, serve, openApp, mutatingProxy, sleep, median, quantile, puppeteer };
