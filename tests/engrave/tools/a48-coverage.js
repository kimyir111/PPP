/* G04 A48 over the Scores the app really holds (fixer P7). Local: needs the app served, puppeteer and Python.

     PORT=8793 node server.js
     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/a48-coverage.js [--url http://127.0.0.1:8793] [--json out.json]

   The Node tests hold legacy.fromScore to Scores that toScore made. The app also holds Scores its own MusicXML reader
   made (parseMusicXML: every recording, rewrite, catalogue match and OMR result), Scores read back from a song slot,
   and old transcriptions migrated when they are opened. This runs the app's own functions in the page over:
     core       the 553 G0 core cases: audio-score toMusicXml -> built.xml + built.graph (tests/bench/node/notate.js
                --emit-graph), then parseMusicXML(built.xml) - the recording path's Score (App 7257)
                  live       agree(score, built.graph)            is the producer's graph usable (RenderSource live)
                  projected  agree(score, fromScore(score).graph) can the Score always be drawn (RenderSource projected)
                  saved      the same after packScore -> JSON -> unpackScore -> Score.finalize (a song slot)
                  migrated   an old transcription, migrateSavedTranscription(), then fromScore
     corpus     every eligible, non-hold-out catalogue file through the app's legacy reader (parseMusicXML / readMxl)
     omr        the committed OMR fixture as recognised (parseMusicXML), and as PdfLayer.apply leaves it (a chord name and
                an 8va written into the Score the way App 10400-10430 writes them)
   Hold-out core cases are counted with the rest and never listed by name (G0 rule). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const puppeteer = require('puppeteer');
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const H = require(path.join(REPO, 'tests', 'engrave', 'helpers.js'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:8793') + '/Piano%20Coach%20App.dc.html';

function coreJobs(tmp) {
  const py = [
    'import json, sys',
    'sys.path.insert(0, "tests/bench")',
    'from pppbench import runner, suite as S',
    's = S.load_suite("core")',
    'cases, rows, perfs = runner.generate(s)',
    'with open(sys.argv[1], "w", encoding="utf-8") as f:',
    '    for c in cases:',
    '        f.write(json.dumps({"id": c.id, "input": perfs[c.id].input, "opts": perfs[c.id].opts, "holdout": bool(c.holdout)}) + "\\n")'
  ].join('\n');
  const jobs = path.join(tmp, 'jobs.jsonl');
  execFileSync('python', ['-c', py, jobs], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  const out = path.join(tmp, 'out.jsonl'), graphs = path.join(tmp, 'graphs.jsonl');
  execFileSync(process.execPath, [path.join(REPO, 'tests', 'bench', 'node', 'notate.js'), '--in', jobs, '--out', out, '--emit-graph', graphs],
    { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  const hold = new Map(fs.readFileSync(jobs, 'utf8').split('\n').filter(Boolean).map(l => { const j = JSON.parse(l); return [j.id, j.holdout]; }));
  const xml = new Map(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.id).map(r => [r.id, r]));
  return fs.readFileSync(graphs, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(g => ({
    id: g.id, holdout: hold.get(g.id), ok: xml.get(g.id) && xml.get(g.id).ok, xml: xml.get(g.id) && xml.get(g.id).xml, graph: g.graph }));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-a48-'));
  let jobs;
  try { jobs = coreJobs(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('core cases: ' + jobs.length + ' (' + jobs.filter(j => j.holdout).length + ' hold-out), written: ' + jobs.filter(j => j.ok && j.graph).length);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });

  /* in the page: one Score through every check */
  await page.evaluate(() => {
    const P = window.PPP, SG = window.PPPScoreGraph, L = SG.legacy;
    const first = ag => (ag && ag.diffs && ag.diffs[0] ? ag.diffs[0].field : null);
    window.__a48 = {
      check(score, graph) {
        const out = {};
        if (graph) { const ag = L.agree(score, graph); out.live = ag.ok; out.liveDiff = first(ag); out.liveDetail = ag.ok ? null : ag.diffs[0].detail; }
        const fr = L.fromScore(score, { inferred: P.inferredAudioNotation(score) });
        const ag2 = fr.ok ? L.agree(score, fr.graph) : null;
        out.projected = !!(ag2 && ag2.ok); out.projDiff = first(ag2); out.projDetail = ag2 && !ag2.ok ? ag2.diffs[0].detail : null;
        out.projLink = !!(ag2 && ag2.ok && L.link(score, fr.graph).ok);
        out.unsupported = (fr.unsupported || []).map(u => u.code);
        out.inferred = fr.ok ? L.inferredNotation(fr.graph) : null;
        return out;
      }
    };
  });

  const res = { core: [], corpus: [], omr: [] };
  const BATCH = 25;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH).filter(j => j.ok && j.graph);
    const rows = await page.evaluate((batch) => batch.map(j => {
      const P = window.PPP, SG = window.PPPScoreGraph, L = SG.legacy;
      const graph = SG.parse(j.graph);
      const score = P.parseMusicXML(j.xml, 'core');
      score.composer = '';
      score.source = { kind: 'audio', status: 'transcribed', amt: 'ensemble', transcriptionVersion: P.TRANSCRIPTION_VERSION };
      const row = Object.assign({ id: j.id, holdout: j.holdout }, window.__a48.check(score, graph));
      /* a song slot: what writeSlot stores (packScore, JSON) and openSong reads back (unpackScore, Score.finalize) */
      const slot = JSON.parse(JSON.stringify(P.packScore(score)));
      const saved = P.Score.finalize(P.unpackScore(slot));
      const s = window.__a48.check(saved, graph);
      row.savedLive = s.live; row.savedProjected = s.projected; row.savedDiff = s.liveDiff || s.projDiff;
      /* an old transcription opened again: migrated, then drawn from its Score */
      const old = JSON.parse(JSON.stringify(P.packScore(score)));
      old.source = Object.assign({}, old.source, { transcriptionVersion: 1 });
      const mig = P.migrateSavedTranscription(P.Score.finalize(P.unpackScore(old)), old.source, { level: 'good', issues: [], suspectMeasures: [] });
      const m = window.__a48.check(mig.score, null);
      row.migratedChanged = !!mig.changed; row.migratedProjected = m.projected; row.migratedDiff = m.projDiff;
      return row;
    }), batch);
    res.core.push(...rows);
    process.stdout.write('\r  core ' + res.core.length + '/' + jobs.length);
  }
  console.log('');

  /* the corpus through the app's own legacy reader */
  const files = H.corpusFiles().filter(f => /\.(musicxml|xml|mxl)$/i.test(f));
  for (let i = 0; i < files.length; i += 20) {
    const batch = files.slice(i, i + 20).map(f => ({ f: f, b64: fs.readFileSync(path.join(REPO, f)).toString('base64') }));
    const rows = await page.evaluate(async batch => {
      const P = window.PPP, out = [];
      for (const x of batch) {
        const bytes = Uint8Array.from(atob(x.b64), c => c.charCodeAt(0));
        let score;
        try {
          const xml = /\.mxl$/i.test(x.f) ? await P.readMxl(bytes.buffer) : new TextDecoder().decode(bytes);
          score = P.parseMusicXML(xml, x.f);
        } catch (e) { out.push({ id: x.f, readError: String(e.message).slice(0, 80) }); continue; }
        out.push(Object.assign({ id: x.f }, window.__a48.check(score, null)));
      }
      return out;
    }, batch);
    res.corpus.push(...rows);
  }

  /* OMR: recognised, and as PdfLayer.apply leaves it */
  const omrXml = fs.readFileSync(path.join(REPO, 'tests', 'bench', 'corpus', 'omr', 'piano-test-score.musicxml'), 'utf8');
  res.omr = await page.evaluate(xml => {
    const P = window.PPP;
    const a = P.parseMusicXML(xml, 'omr.png');
    const b = P.parseMusicXML(xml, 'omr.pdf');
    /* PdfLayer.apply (App 10400-10430): chord names from the page's text, and an 8va written into the notes it covers */
    b.chords = (b.chords || []).concat([{ m: b.measures[0].number, b: 0, text: 'Am7' }]);
    const onStaff = n => (n.staff || 1) === 1 && !n.rest && !!n.p;
    const ns = b.notes.filter(n => onStaff(n) && n.m === b.measures[1].number);
    if (ns.length) {
      const first = ns[0], last = ns[ns.length - 1];
      ns.forEach(n => {
        const written = n.writtenP || n.p;
        n.writtenP = written; n.writtenMidi = P.pitchToMidi(written);
        n.ottavaShift = 12;
        n.p = written.replace(/(\d+)$/, d => String(+d + 1));
        n.midi = P.pitchToMidi(n.p); n.soundingMidi = n.midi;
      });
      b.ottavas = (b.ottavas || []).concat([{ m: first.m, b: first.b, endM: last.m, endB: last.b + 0.001, size: 8, dir: 1, semitones: 12, staff: 1 }]);
    }
    return [Object.assign({ id: 'omr (as recognised)' }, window.__a48.check(a, null)), Object.assign({ id: 'omr (after PdfLayer)' }, window.__a48.check(b, null))];
  }, omrXml);
  await browser.close();

  /* ---- report */
  const count = (rows, k) => rows.filter(r => r[k]).length;
  const byField = (rows, ok, field) => {
    const m = {};
    rows.filter(r => !r[ok]).forEach(r => { const f = r[field] || '?'; m[f] = (m[f] || 0) + 1; });
    return m;
  };
  const core = res.core, open = core.filter(r => !r.holdout), held = core.filter(r => r.holdout);
  const summary = {
    core: { cases: core.length, holdout: held.length,
      live: count(core, 'live'), projected: count(core, 'projected'), projectedLinked: count(core, 'projLink'),
      savedLive: count(core, 'savedLive'), savedProjected: count(core, 'savedProjected'),
      migratedChanged: count(core, 'migratedChanged'), migratedProjected: count(core, 'migratedProjected'),
      inferred: count(core, 'inferred'),
      liveFailuresByField: byField(core, 'live', 'liveDiff'), projectedFailuresByField: byField(core, 'projected', 'projDiff'),
      failingCases: open.filter(r => !r.live || !r.projected || !r.savedLive || !r.savedProjected || !r.migratedProjected)
        .map(r => ({ id: r.id, live: r.live, liveDetail: r.liveDetail, projected: r.projected, projDetail: r.projDetail })),
      holdoutFailing: held.filter(r => !r.live || !r.projected || !r.savedLive || !r.savedProjected || !r.migratedProjected).length },
    corpus: { files: res.corpus.length, readErrors: res.corpus.filter(r => r.readError).length, projected: count(res.corpus, 'projected'),
      projectedLinked: count(res.corpus, 'projLink'), failuresByField: byField(res.corpus.filter(r => !r.readError), 'projected', 'projDiff'),
      failing: res.corpus.filter(r => r.readError || !r.projected).map(r => ({ id: r.id, readError: r.readError, diff: r.projDiff, detail: r.projDetail, unsupported: r.unsupported })) },
    omr: res.omr.map(r => ({ id: r.id, projected: r.projected, linked: r.projLink, diff: r.projDiff, unsupported: r.unsupported }))
  };
  console.log(JSON.stringify(summary, null, 1));
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify({ summary: summary, rows: { core: open, corpus: res.corpus, omr: res.omr } }, null, 1));
  const bad = summary.core.cases - summary.core.live + summary.core.cases - summary.core.projected + summary.corpus.files - summary.corpus.projected - summary.corpus.readErrors;
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
