#!/usr/bin/env node
/* T1-O OMR live (docs/GOALS/G00 Step 12): each fixture goes through the app's
   own PPP.Import.load(File) in the real page — Audiveris via the local helper,
   the merge, PdfLayer and validation — and the Score it returns is projected.

     node tests/bench/node/omr-live.js --in jobs.jsonl --out out.jsonl [--base http://127.0.0.1:8777]

   Input line: {"id", "path", "type"}. Output line: {"id", "ok", "projection",
   "report", "engine", "pages", "ms"} or {"id", "ok": false, "error"}. The
   Score is projected directly (not re-read from the returned MusicXML, which
   can be the first-pass text: §14 I4). */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const searchPaths = [path.join(repoRoot, 'node_modules')].concat(
  (process.env.PPP_BENCH_NODE_MODULES || '').split(path.delimiter).filter(Boolean));
const puppeteer = require(require.resolve('puppeteer', { paths: searchPaths }));
const base = arg('--base', 'http://127.0.0.1:8777');

(async () => {
  const jobs = fs.readFileSync(arg('--in'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const out = fs.openSync(arg('--out'), 'w');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);
    await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPP.Import.load, { timeout: 30000 });
    for (const job of jobs) {
      const b64 = fs.readFileSync(job.path).toString('base64');
      const t0 = Date.now();
      const row = await page.evaluate(async (b64, name, type, id) => {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], name, { type: type });
          const r = await window.PPP.Import.load(file, null, { cancelled: false });
          const s = r.score;
          const index = {};
          s.measures.forEach((m, i) => { index[m.number] = i; });
          const rep = r.report || {};
          return {
            id: id, ok: true, engine: (r.source && (r.source.engine || r.source.kind)) || null,
            pages: (r.pageImages || []).length,
            report: { confidence: rep.confidence == null ? null : rep.confidence, level: rep.level || null,
              suspectMeasures: (rep.suspectMeasures || []).map(x => typeof x === 'object' ? x.m || x.number : x),
              issues: (rep.issues || []).length },
            projection: {
              title: s.title, tempo: s.tempo, staves: s.staves,
              measures: s.measures.map(m => ({ number: String(m.number), startQ: m.startQ, lenQ: m.lenQ,
                time: [m.time.beats, m.time.beatType], fifths: m.key.fifths, mode: m.key.mode })),
              notes: s.notes.map(n => ({ m: index[n.m], b: n.b, dur: n.dur, midi: n.midi, writtenMidi: n.writtenMidi,
                p: n.writtenP || n.p || null, staff: n.staff, hand: n.hand, voice: n.voice, rest: !!n.rest,
                chord: !!n.chord, tieStart: !!n.tieStart, tieStop: !!n.tieStop, tm: n.tm || null,
                type: n.type || null, dots: n.dots || 0, acc: n.acc || null }))
            }
          };
        } catch (e) {
          return { id: id, ok: false, error: String(e && e.message || e), code: (e && e.code) || null };
        }
      }, b64, path.basename(job.path), job.type, job.id);
      row.ms = Date.now() - t0;
      fs.writeSync(out, JSON.stringify(row) + '\n');
    }
  } finally {
    fs.closeSync(out);
    await browser.close();
  }
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(3); });
