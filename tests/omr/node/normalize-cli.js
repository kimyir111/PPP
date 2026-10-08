#!/usr/bin/env node
/* omr-live-2 (G12-1): omr/normalize.js on the files Audiveris wrote, for the benchmark's engine-alone mode.

     node tests/omr/node/normalize-cli.js --jobs jobs.json --out answers.json

   jobs.json: [{ "key": "<case>|<tier>", "pages": [["page1.mvt1.mxl", "page1.mvt2.mxl"], ["page2.mxl"]] }, ...]  (a page is the list of the
   .mxl files Audiveris exported for it, in movement order; a missing page is [])
   answers.json: { "<key>": { "ok", "error", "xml", "report", "pages": [{index, ok, movements, bars}] } }

   The .mxl reader is the helper's (omr-service.js readMxlSync: the zip's central directory), so the benchmark reads a file the way the
   helper does. Nothing else is read or written. */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function readMxl(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') return buf.toString('utf8').replace(/^﻿/, '');
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lName = buf.readUInt16LE(localOff + 26), lExtra = buf.readUInt16LE(localOff + 28);
    entries[name] = { method: method, start: localOff + 30 + lName + lExtra, comp: comp };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = key => {
    const e = entries[key];
    if (!e) return null;
    const raw = buf.subarray(e.start, e.start + e.comp);
    return (e.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
  };
  let target = null;
  const container = read('META-INF/container.xml');
  if (container) { const m = /full-path\s*=\s*"([^"]+)"/.exec(container); if (m) target = m[1]; }
  if (!target || !entries[target]) target = Object.keys(entries).find(k => /\.(xml|musicxml)$/i.test(k) && k.indexOf('META-INF') !== 0);
  if (!target) throw new Error('no MusicXML inside the .mxl');
  return read(target);
}

function arg(name, dflt) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; }

function main() {
  const { normalize } = require(path.join(__dirname, '..', '..', '..', 'omr', 'normalize.js'));
  const jobs = JSON.parse(fs.readFileSync(arg('--jobs'), 'utf8'));
  const outDir = arg('--outdir', null);
  const answers = {};
  jobs.forEach(job => {
    const pages = job.pages.map(files => files.map(f => { try { return readMxl(f); } catch (e) { return null; } }).filter(Boolean));
    const r = normalize(pages, { pageBars: job.pageBars || null });
    answers[job.key] = { ok: r.ok, error: r.error || null, xml: r.xml, report: r.report, pages: r.pages.map(p => ({ index: p.index, ok: p.ok, movements: p.movements, bars: p.bars })) };
    if (outDir && r.ok) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, job.key.replace(/[^A-Za-z0-9_.-]+/g, '_') + '.musicxml'), r.xml); }
  });
  fs.writeFileSync(arg('--out'), JSON.stringify(answers));
}
if (require.main === module) main();
module.exports = { readMxl };
