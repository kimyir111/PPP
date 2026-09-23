#!/usr/bin/env node
/* M1 shadow: the app's own reader against the graph's (docs/GOALS/G02 §14.2, A32, A33).

     node tests/scoregraph/tools/shadow-legacy.js [--limit N] [--filter substring] [--dump id] [--base URL]

   Both readers run in the real page, because that is the only place `parseMusicXML` exists. For each
   committed MusicXML file it computes

     a = PPP.parseMusicXML(text, name)                       the app's Score
     b = PPPScoreGraph.legacy.toScore(import(text), {name})  the graph's, finalized the same way

   and reports the first difference of every field, not just that there was one. The contract is
   G01 Appendix B: b must be what a is, field for field, so the import boundary can move without any
   consumer noticing.

   Needs `npm start` and puppeteer. --dump prints one Score's shape instead of comparing, which is how
   the adapter was written in the first place. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const searchPaths = [path.join(repoRoot, 'node_modules')].concat(
  (process.env.PPP_BENCH_NODE_MODULES || '').split(path.delimiter).filter(Boolean));
const puppeteer = require(require.resolve('puppeteer', { paths: searchPaths }));
const base = arg('--base', 'http://127.0.0.1:8777');
const limit = Number(arg('--limit', '0')) || 0;
const filter = arg('--filter', '');
const dump = arg('--dump', '');
const check = process.argv.includes('--check');

/* Which files are allowed to differ, and for which of three named reasons (G02 §14.3). A file that
   differs and is not here fails; so does a listed file whose difference is not the reason it names. */
const ALLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shadow-allowlist.json'), 'utf8'));
const allowed = new Map(ALLOW.files.map(f => [f.path, f.reason]));
/* the fields each reason may move, and nothing else */
const REASON_FIELDS = {
  'chord-head-order': ['notes.order', 'notes.chord'],
  'ending-stop-without-start': ['measures.bar'],
  'wedge-unpaired': ['wedges', 'wedges.length'],
  'microtone-rounded': ['notes.set'],
  'transpose-sounds': ['notes.set']
};

/* every committed MusicXML, the way sg-roundtrip finds them */
const ROOTS = ['catalog', 'samples', 'tests/bench/corpus', 'tests/fixtures', 'tests/scoregraph/fixtures/xml'];
function readEntry(p) {
  if (!p.endsWith('.mxl')) return fs.readFileSync(p, 'utf8');
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(at + 10, true), compSize = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true), extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true), local = dv.getUint32(at + 42, true);
    entries.push({ name: b.subarray(at + 46, at + 46 + nameLen).toString('utf8'), method, compSize, local });
    at += 46 + nameLen + extraLen + commentLen;
  }
  const get = e => {
    const nl = dv.getUint16(e.local + 26, true), el = dv.getUint16(e.local + 28, true);
    const raw = b.subarray(e.local + 30 + nl + el, e.local + 30 + nl + el + e.compSize);
    return (e.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
  };
  const container = entries.find(e => e.name === 'META-INF/container.xml');
  let want = null;
  if (container) {
    const m = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i.exec(get(container));
    if (m) want = entries.find(e => e.name === m[1]);
  }
  if (!want) want = entries.find(e => /\.(musicxml|xml)$/i.test(e.name) && e.name.indexOf('META-INF/') !== 0);
  return get(want);
}
function files() {
  const out = [];
  ROOTS.forEach(root => {
    const from = path.join(repoRoot, root);
    if (!fs.existsSync(from)) return;
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(musicxml|mxl|xml)$/i.test(e.name)) out.push(p);
      });
    })(from);
  });
  return out.sort().map(p => ({ id: path.relative(repoRoot, p).replace(/\\/g, '/'), name: path.basename(p) }));
}

(async () => {
  let jobs = files();
  if (filter) jobs = jobs.filter(j => j.id.includes(filter));
  if (limit) jobs = jobs.slice(0, limit);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => process.stderr.write('page error: ' + e.message + '\n'));
  await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('typeof PPP === "object" && typeof PPPScoreGraph === "object"', { timeout: 120000 });

  const totals = new Map();
  let same = 0, differ = 0, failed = 0, known = 0;
  const unexpected = [];
  for (const job of jobs) {
    let text;
    try { text = readEntry(path.join(repoRoot, job.id)); } catch (e) { failed++; continue; }
    const r = await page.evaluate(async (src, name, dumpIt) => {
      const finalize = s => PPP.Score.finalize(s);
      let a, b;
      try { a = PPP.parseMusicXML(src, name); } catch (e) { return { stage: 'app', error: String(e.message || e) }; }
      try {
        const imp = PPPScoreGraph.musicxml.import(src, { scoreId: 'shadow', sourceName: name });
        if (!imp.ok) return { stage: 'import', error: imp.code + ' ' + imp.message };
        b = finalize(PPPScoreGraph.legacy.toScore(imp.graph, { name: name }));
      } catch (e) { return { stage: 'adapter', error: String(e.message || e) }; }
      if (dumpIt) return { dump: PPPScoreGraph.legacy.describe(a, b) };
      return { diff: PPPScoreGraph.legacy.compare(a, b) };
    }, text, job.name, dump && job.id === dump);
    if (r.dump) { process.stdout.write(JSON.stringify(r.dump, null, 1) + '\n'); continue; }
    if (r.error) {
      failed++;
      process.stdout.write('ERROR ' + job.id + ' [' + r.stage + '] ' + r.error + '\n');
      totals.set(r.stage + ': ' + r.error.slice(0, 60), (totals.get(r.stage + ': ' + r.error.slice(0, 60)) || 0) + 1);
      continue;
    }
    if (!r.diff.length) {
      same++;
      if (allowed.has(job.id)) unexpected.push(job.id + ': listed as differing (' + allowed.get(job.id) + ') but is identical');
      continue;
    }
    differ++;
    r.diff.forEach(d => totals.set(d.field, (totals.get(d.field) || 0) + 1));
    const reason = allowed.get(job.id);
    if (!reason) unexpected.push(job.id + ': differs and is not in the allowlist (' + r.diff.map(d => d.field).join(', ') + ')');
    else {
      const may = REASON_FIELDS[reason] || [];
      const stray = r.diff.map(d => d.field).filter(f => may.indexOf(f) < 0);
      if (stray.length) unexpected.push(job.id + ': allowed for ' + reason + ', but also differs in ' + stray.join(', '));
      else known++;
    }
    if (!check && differ <= 40) process.stdout.write('DIFF  ' + job.id + '\n' + r.diff.map(d => '        ' + d.field + ': ' + d.detail).join('\n') + '\n');
  }
  await browser.close();
  process.stdout.write('\nshadow: ' + jobs.length + ' files, ' + same + ' identical, ' + known + ' differing for a listed reason, ' +
    (differ - known) + ' unexpected, ' + failed + ' unreadable\n');
  if (totals.size && !check) {
    process.stdout.write('by field:\n');
    Array.from(totals.entries()).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => process.stdout.write('  ' + String(v).padStart(5) + '  ' + k + '\n'));
  }
  if (unexpected.length) {
    process.stdout.write('\nunexpected:\n' + unexpected.map(u => '  ' + u).join('\n') + '\n');
    process.exit(1);
  }
  if (failed) process.exit(1);
  process.stdout.write('every file is the app\'s own Score, or differs only for a reason the allowlist names\n');
  process.exit(0);
})();
