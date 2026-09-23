#!/usr/bin/env node
/* The flip, checked in the real page (docs/GOALS/G02 §14.2, A34-A38).

     node tests/scoregraph/tools/app-import-check.js [--base URL]

   Opens the app and drives its own import entry point - Import.load, the one the file picker calls -
   with a real File for each format, then checks what a person would get:

     .musicxml / .mxl   the same Score as parseMusicXML, through the graph
     .mid               a Score with bars and notes, marked as PPP's reading
     a broken file      a message, not a crash
     PPP.legacyImport   the way back still works

   Needs `npm start` and puppeteer. */
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

const b64 = p => fs.readFileSync(p).toString('base64');
const CASES = [
  { name: 'fur-elise.musicxml', file: 'catalog/fur-elise.musicxml', kind: 'musicxml' },
  { name: '001.mxl', file: 'catalog/method/burgmuller25/001.mxl', kind: 'mxl' },
  { name: 'piece.mid', file: 'tests/scoregraph/fixtures/midi/m27-twenty-notes.mid', kind: 'midi' }
];

let failures = 0;
const ok = (what, cond, detail) => {
  process.stdout.write((cond ? '  ok   ' : '  FAIL ') + what + (detail ? '  ' + detail : '') + '\n');
  if (!cond) failures++;
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('typeof PPP === "object" && typeof PPPScoreGraph === "object"', { timeout: 120000 });

  /* what the file picker hands Import.load */
  await page.evaluate(() => {
    window.fileOf = (name, b64s, type) => {
      const bin = atob(b64s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new File([u], name, { type: type || '' });
    };
  });

  for (const c of CASES) {
    process.stdout.write('\n' + c.name + '\n');
    const r = await page.evaluate(async (name, data) => {
      const f = window.fileOf(name, data);
      const stages = [];
      try {
        const out = await PPP.Import.load(f, s => stages.push(s));
        const sc = out.score;
        return {
          ok: true, stages: stages, kind: await PPP.Import.sniff(f),
          measures: sc.measures.length, notes: sc.notes.length, sounding: sc.notes.filter(n => !n.rest).length,
          title: sc.title, tempo: sc.tempo, staves: sc.staves,
          sgFrom: sc.sgFrom || null,
          hasGraph: !!(out.source && out.source.graph),
          report: out.report ? { level: out.report.level, inferredNotation: !!out.report.inferredNotation,
            summary: out.report.summary ? out.report.summary.slice(0, 60) : null } : null,
          importReport: out.source && out.source.importReport
            ? { format: out.source.importReport.format, inferred: out.source.importReport.inferredNotation,
              dropped: out.source.importReport.dropped.length, warnings: out.source.importReport.warnings.length,
              midi: out.source.importReport.midi }
            : null
        };
      } catch (e) { return { ok: false, error: String(e.message || e), soft: !!e.soft, stages: stages }; }
    }, c.name, b64(path.join(repoRoot, c.file)));

    if (!r.ok) { ok('imports', false, r.error); continue; }
    ok('sniffed as ' + c.kind, r.kind === c.kind, 'got ' + r.kind);
    ok('has bars and notes', r.measures > 0 && r.sounding > 0, r.measures + ' bars, ' + r.sounding + ' sounding');
    ok('the graph is kept on the import', r.hasGraph);
    ok('the report names the format', r.importReport && r.importReport.format === c.kind, JSON.stringify(r.importReport));
    if (c.kind === 'midi') {
      ok('the Score says its notation is inferred', r.sgFrom && r.sgFrom.inferred === true, JSON.stringify(r.sgFrom));
      ok('and so does the report a person sees', r.report && r.report.inferredNotation === true && !!r.report.summary,
        JSON.stringify(r.report));
      ok('no MIDI note was lost on the way in', r.importReport && r.importReport.midi && r.importReport.midi.dropped === 0,
        JSON.stringify(r.importReport && r.importReport.midi));
    } else {
      ok('the Score does not claim to be inferred', r.sgFrom && r.sgFrom.inferred === false, JSON.stringify(r.sgFrom));
      /* and it is the same Score the old reader built */
      const same = await page.evaluate(async (name, data) => {
        const f = window.fileOf(name, data);
        PPP.legacyImport = true;
        const old = await PPP.Import.load(f);
        PPP.legacyImport = false;
        const now = await PPP.Import.load(f);
        return PPPScoreGraph.legacy.compare(old.score, now.score).map(d => d.field);
      }, c.name, b64(path.join(repoRoot, c.file)));
      ok('the way back gives the same Score', same.length === 0, same.join(', '));
    }
  }

  process.stdout.write('\na file PPP cannot read\n');
  const bad = await page.evaluate(async () => {
    const out = {};
    for (const [label, name, body] of [['not a score', 'x.musicxml', 'this is not xml at all'],
      ['empty', 'y.musicxml', ''], ['not MIDI', 'z.mid', 'nope']]) {
      const f = new File([body], name);
      try { await PPP.Import.load(f); out[label] = 'no error'; }
      catch (e) { out[label] = (e.soft ? 'soft: ' : 'hard: ') + String(e.message || e).slice(0, 50); }
    }
    return out;
  });
  Object.keys(bad).forEach(k => ok(k + ' is refused with a message', /^(soft|hard):/.test(bad[k]), bad[k]));

  ok('the page raised no error of its own', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  process.stdout.write('\n' + (failures ? failures + ' failed\n' : 'the import boundary is on the graph, and the way back works\n'));
  process.exit(failures ? 1 : 0);
})();
