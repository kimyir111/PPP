#!/usr/bin/env node
/* T1-C parse conformance (docs/GOALS/G00 §8.2, Step 12): the app's own
   PPP.parseMusicXML, in the real page, over a JSONL batch of MusicXML texts.

     node tests/bench/node/conformance.js --in files.jsonl --out app.jsonl [--base http://127.0.0.1:8777]

   Input line: {"id", "xml"}. Output line: {"id", "ok", "measures", "notes",
   "tempo", "staves"} or {"id", "ok": false, "error"}. Needs `npm start`,
   network access for the page's CDN scripts, and puppeteer (resolved from the
   repository's node_modules or PPP_BENCH_NODE_MODULES). */
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
const inPath = arg('--in');
const outPath = arg('--out');

(async () => {
  const jobs = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const out = fs.openSync(outPath, 'w');
  try {
    const page = await browser.newPage();
    await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.PPP && window.PPP.parseMusicXML, { timeout: 30000 });
    for (const job of jobs) {
      const row = await page.evaluate((xml, id) => {
        try {
          const s = window.PPP.parseMusicXML(xml, id);
          const index = {};
          s.measures.forEach((m, i) => { index[m.number] = i; });
          /* what the app's player strikes and holds: PianoScore.ties is the rule playback uses */
          const plan = window.PPP.PianoScore.ties(s);
          return {
            id: id, ok: true, tempo: s.tempo, staves: s.staves,
            measures: s.measures.map(m => ({ number: m.number, startQ: m.startQ, lenQ: m.lenQ,
              time: [m.time.beats, m.time.beatType], fifths: m.key.fifths, mode: m.key.mode })),
            notes: s.notes.filter(n => !n.rest && n.midi != null).map(n => ({
              /* the written spelling: under an ottava the app keeps it in writtenP and shifts p */
              m: index[n.m], b: n.b, dur: n.dur, midi: n.midi, hand: n.hand, staff: n.staff, p: n.writtenP || n.p || null,
              tm: n.tm ? [n.tm.a, n.tm.n] : null,
              /* the printed shape the renderer draws (VF_TYPE[type], dots) */
              type: n.type || null, dots: n.dots || 0,
              struck: !(n.tieStop && plan.cont.has(n)),
              hold: plan.hold.has(n) ? plan.hold.get(n) : n.dur })),
            rests: s.notes.filter(n => n.rest).map(n => ({ m: index[n.m], b: n.b, dur: n.dur, staff: n.staff,
              type: n.type || null, dots: n.dots || 0, tm: n.tm ? [n.tm.a, n.tm.n] : null }))
          };
        } catch (e) {
          return { id: id, ok: false, error: String(e && e.message || e) };
        }
      }, job.xml, job.id);
      fs.writeSync(out, JSON.stringify(row) + '\n');
    }
  } finally {
    fs.closeSync(out);
    await browser.close();
  }
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(3); });
