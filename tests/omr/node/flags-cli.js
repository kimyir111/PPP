#!/usr/bin/env node
/* omr-live-2 (G12-3): omr/flags.js on the files Audiveris wrote, for the benchmark.

     node tests/omr/node/flags-cli.js --jobs jobs.json --out answers.json [--params params.json] [--raw]

   jobs.json: [{ "key": "<case>|<tier>", "pages": [["page1.mvt1.mxl", "page1.mvt2.mxl"], ["page2.mxl"]], "pageBars": [..] }, ...]   (as normalize-cli.js)
              or { "key": "<case>|truth", "xml": "truth.musicxml" }   (a MusicXML file read as it is: the truth fed back as if it were recognised)
   answers.json: { "<key>": { ok, error, xml, normalize: {flags, counts}, importOk, bars: N, suspect: [bar number...], flags: [per bar {n, suspect, strong, weak}],
                              confidence, raw: [features], doc } }

   Each OMR job: omr/normalize.js (G12-1) -> scoregraph/import.js (the one door) -> omr/flags.js. `xml` is the normalised document, so the
   benchmark's Python reads the SAME bars (output bar i of the xml is bar i + 1 here). `raw` (with --raw) is the per-bar feature object the
   fit tool reads. Nothing else is read or written. */
'use strict';
const fs = require('fs');
const path = require('path');
const { readMxl } = require('./normalize-cli.js');

const REPO = path.join(__dirname, '..', '..', '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };

async function one(job, mods, params, raw) {
  let xml, nreport = null;
  const out = { ok: true, error: null, xml: null, normalize: { flags: {}, counts: {} }, bars: 0, importOk: false };
  if (job.xml) {
    xml = fs.readFileSync(job.xml, 'utf8');
  } else {
    const pages = job.pages.map(files => files.map(f => { try { return readMxl(f); } catch (e) { return null; } }).filter(Boolean));
    const norm = mods.normalize(pages, { pageBars: job.pageBars || null });
    out.ok = norm.ok; out.error = norm.error || null; out.xml = norm.xml;
    out.normalize = { flags: norm.report.flags, counts: norm.report.counts };
    if (!norm.ok) return out;
    xml = norm.xml; nreport = norm.report;
  }
  let got;
  try { got = await mods.importer.importFile(Buffer.from(xml, 'utf8'), { name: 'omr.musicxml' }); } catch (e) { got = { ok: false, code: 'throw', message: String(e && e.message || e) }; }
  if (!got.ok) { out.importError = got.code || 'import'; return out; }
  out.importOk = true;
  const res = mods.flags.analyze(got.graph, { normalize: nreport, layout: job.layout || null, params: params });
  out.bars = res.bars ? res.bars.length : 0;
  out.suspect = res.suspect || [];
  out.flags = (res.bars || []).map(b => ({ n: b.n, suspect: b.suspect, strong: b.strong, weak: b.weak }));
  out.confidence = res.confidence;
  if (raw && res.features) { out.raw = res.features.bars; out.doc = res.features.doc; }
  return out;
}

async function main() {
  const mods = { normalize: require(path.join(REPO, 'omr', 'normalize.js')).normalize, importer: require(path.join(REPO, 'scoregraph', 'import.js')), flags: require(path.join(REPO, 'omr', 'flags.js')) };
  const jobs = JSON.parse(fs.readFileSync(arg('--jobs'), 'utf8'));
  const params = arg('--params', null) ? JSON.parse(fs.readFileSync(arg('--params'), 'utf8')) : null;
  const raw = process.argv.includes('--raw');
  const answers = {};
  for (const job of jobs) answers[job.key] = await one(job, mods, params, raw);
  fs.writeFileSync(arg('--out'), JSON.stringify(answers));
}
if (require.main === module) main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
module.exports = { one };
