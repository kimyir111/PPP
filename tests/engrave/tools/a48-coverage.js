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

/* The populations this gate must see, recorded (G4a final review MINOR, closed in G4b). Each is also derived at run time -
   core from the suite definition (pppbench suite.expand, before anything is generated or notated), corpus from the
   provenance rule (helpers.corpusFiles) - and the gate fails when the derived one differs from the record (the
   population changed: update the record knowingly), when a case of it has no result (a generator or notator dropped
   it), or when an allowlist entry is outside the population or no longer loses anything. */
const EXPECTED = { core: 553, corpus: 318 };

/* The corpus through the app's own (legacy) reader: what that Score states and a graph refuses, by file - the code
   fromScore names it with, and the only fields it may change (the rule of tests/engrave/a48.test.js). Anything else
   that differs is a new loss and fails. */
const CORPUS_KNOWN_LOSS = {
  /* an ending the file closes with no opening: the graph refuses it (E-ENDING), the bar keeps it */
  'catalog/method/burgmuller25/016.mxl': { code: 'ending-stop-without-start', fields: ['measures.bar'] },
  'tests/scoregraph/fixtures/xml/ending-stop-without-start.musicxml': { code: 'ending-stop-without-start', fields: ['measures.bar'] },
  /* a hairpin the file stops with no start (or never closes): the graph refuses it */
  'catalog/method/sonatina/014.mxl': { code: 'wedge-stop-without-start', fields: ['wedges'] },
  'catalog/method/sonatina/026.mxl': { code: 'wedge-stop-without-start', fields: ['wedges'] },
  'catalog/method/sonatina/027.mxl': { code: 'wedge-stop-without-start', fields: ['wedges'] },
  'tests/scoregraph/fixtures/xml/wedge-unpaired.musicxml': { code: 'wedge-stop-without-start', fields: ['wedges'] },
  /* percussion: no pitch a Score can hold */
  'tests/scoregraph/fixtures/xml/unpitched.musicxml': { code: 'percussion-or-unpitched', fields: ['notes.count'] }
};

function coreJobs(tmp) {
  const py = [
    'import json, sys',
    'sys.path.insert(0, "tests/bench")',
    'from pppbench import runner, corpus as C, suite as S',
    's = S.load_suite("core")',
    'with open(sys.argv[2], "w", encoding="utf-8") as f:',
    '    json.dump([{"id": c.id, "holdout": bool(c.holdout)} for c in S.expand(s, C.load_corpus())], f)',
    'cases, rows, perfs = runner.generate(s)',
    'with open(sys.argv[1], "w", encoding="utf-8") as f:',
    '    for c in cases:',
    '        f.write(json.dumps({"id": c.id, "input": perfs[c.id].input, "opts": perfs[c.id].opts, "holdout": bool(c.holdout)}) + "\\n")'
  ].join('\n');
  const jobs = path.join(tmp, 'jobs.jsonl'), expectedFile = path.join(tmp, 'expected.json');
  execFileSync('python', ['-c', py, jobs, expectedFile], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const out = path.join(tmp, 'out.jsonl'), graphs = path.join(tmp, 'graphs.jsonl');
  execFileSync(process.execPath, [path.join(REPO, 'tests', 'bench', 'node', 'notate.js'), '--in', jobs, '--out', out, '--emit-graph', graphs],
    { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  const hold = new Map(fs.readFileSync(jobs, 'utf8').split('\n').filter(Boolean).map(l => { const j = JSON.parse(l); return [j.id, j.holdout]; }));
  const xml = new Map(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.id).map(r => [r.id, r]));
  const byId = new Map(fs.readFileSync(graphs, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(g => [g.id, g]));
  /* one job per EXPECTED case: a case the generator or the notator did not write is kept, as not written */
  return { expected: expected, jobs: expected.map(e => {
    const g = byId.get(e.id), x = xml.get(e.id);
    return { id: e.id, holdout: e.holdout, ok: !!(x && x.ok), xml: x && x.xml, graph: g ? g.graph : null };
  }) };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-a48-'));
  let jobs, expectedCore;
  try { const c = coreJobs(tmp); jobs = c.jobs; expectedCore = c.expected; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const unwritten = jobs.filter(j => !(j.ok && j.graph));
  console.log('core cases expected (suite definition): ' + expectedCore.length + ' (' + expectedCore.filter(j => j.holdout).length + ' hold-out), written: ' + (jobs.length - unwritten.length));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPEngrave, { timeout: 30000 });

  /* in the page: one Score through every check. Strict, as tests/engrave/a48.test.js: the same comparator
     (tests/engrave/a48-compare.js), the app's own Score.finalize on the rebuilt side. */
  await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'a48-compare.js'), 'utf8') });
  await page.evaluate(() => {
    const P = window.PPP, SG = window.PPPScoreGraph, L = SG.legacy;
    const first = ag => (ag && ag.diffs && ag.diffs[0] ? ag.diffs[0].field : null);
    window.__a48 = {
      check(score, graph) {
        const out = {};
        if (graph) { const ag = L.agree(score, graph); out.live = ag.ok; out.liveDiff = first(ag); out.liveDetail = ag.ok ? null : ag.diffs[0].detail; }
        const fr = L.fromScore(score, { inferred: P.inferredAudioNotation(score) });
        out.unsupported = fr.ok ? fr.unsupported.map(u => u.code) : ['fromScore-failed'];
        if (!fr.ok) { out.fields = ['fromScore']; out.projLink = false; return out; }
        const back = P.Score.finalize(L.toScore(fr.graph, { name: 'back', id: score.id }));
        out.fields = window.PPPA48.fieldsThatDiffer(L, score, back);
        out.agree = L.agree(score, fr.graph).ok;
        out.projLink = L.link(score, fr.graph).ok;
        out.inferred = L.inferredNotation(fr.graph);
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
      row.savedLive = s.live; row.savedFields = s.fields; row.savedUnsupported = s.unsupported;
      /* an old transcription opened again: migrated, then drawn from its Score */
      const old = JSON.parse(JSON.stringify(P.packScore(score)));
      old.source = Object.assign({}, old.source, { transcriptionVersion: 1 });
      const mig = P.migrateSavedTranscription(P.Score.finalize(P.unpackScore(old)), old.source, { level: 'good', issues: [], suspectMeasures: [] });
      const m = window.__a48.check(mig.score, null);
      row.migratedChanged = !!mig.changed; row.migratedFields = m.fields; row.migratedUnsupported = m.unsupported;
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

  /* ---- report, and the gate: every Score comes back exactly, or loses only what a known loss names */
  const A48 = require(path.join(REPO, 'tests', 'engrave', 'a48-compare.js'));
  const exact = (fields, codes, rule) => !fields || !fields.length || A48.knownLoss(rule, codes || [], fields);
  const coreBad = r => !r.live || !exact(r.fields, r.unsupported) || !r.savedLive || !exact(r.savedFields, r.savedUnsupported) ||
    !exact(r.migratedFields, r.migratedUnsupported) || !r.projLink;
  const core = res.core, held = core.filter(r => r.holdout);
  const failingCore = core.filter(coreBad);
  /* population: derived = recorded, every expected case answered */
  const population = [];
  if (expectedCore.length !== EXPECTED.core) population.push('core: the suite defines ' + expectedCore.length + ' cases, the record says ' + EXPECTED.core);
  if (files.length !== EXPECTED.corpus) population.push('corpus: the rule gives ' + files.length + ' files, the record says ' + EXPECTED.corpus);
  const answered = new Set(core.map(r => r.id));
  /* against the suite's own list, not the jobs made from it: a case lost anywhere on the way is missing */
  const missingCore = expectedCore.filter(e => !answered.has(e.id));
  if (missingCore.length) population.push('core: ' + missingCore.length + ' expected case(s) with no result (not written: ' + unwritten.length + ')' +
    (missingCore.filter(j => !j.holdout).length ? ' - e.g. ' + missingCore.filter(j => !j.holdout).slice(0, 3).map(j => j.id).join(', ') : ''));
  const seenFiles = new Set(res.corpus.map(r => r.id));
  const missingFiles = files.filter(f => !seenFiles.has(f));
  if (missingFiles.length) population.push('corpus: ' + missingFiles.length + ' file(s) with no result - ' + missingFiles.slice(0, 3).join(', '));
  /* allowlist hygiene: an entry outside the population, or one whose file no longer loses anything */
  const allowlist = [];
  Object.keys(CORPUS_KNOWN_LOSS).forEach(f => {
    if (files.indexOf(f) < 0) { allowlist.push(f + ': not in the corpus population'); return; }
    const r = res.corpus.find(x => x.id === f);
    if (r && !r.readError && (!r.fields || !r.fields.length)) allowlist.push(f + ': allowlisted but comes back exact - take it off the list');
  });
  const corpusBad = res.corpus.filter(r => r.readError || !exact(r.fields, r.unsupported, CORPUS_KNOWN_LOSS[r.id]));
  const corpusKnown = res.corpus.filter(r => !r.readError && r.fields && r.fields.length && A48.knownLoss(CORPUS_KNOWN_LOSS[r.id], r.unsupported, r.fields));
  const omrBad = res.omr.filter(r => !exact(r.fields, r.unsupported));
  const tally = (rows, k) => { const m = {}; rows.forEach(r => (r[k] || []).forEach(f => { m[f] = (m[f] || 0) + 1; })); return m; };
  const summary = {
    core: { cases: core.length, holdout: held.length, live: core.filter(r => r.live).length,
      projectedExact: core.filter(r => exact(r.fields, r.unsupported)).length, projectedLinked: core.filter(r => r.projLink).length,
      savedLive: core.filter(r => r.savedLive).length, savedExact: core.filter(r => exact(r.savedFields, r.savedUnsupported)).length,
      migratedChanged: core.filter(r => r.migratedChanged).length, migratedExact: core.filter(r => exact(r.migratedFields, r.migratedUnsupported)).length,
      inferred: core.filter(r => r.inferred).length,
      failingFields: tally(failingCore, 'fields'),
      /* hold-out cases are counted, never named (G0 rule) */
      failing: failingCore.filter(r => !r.holdout).map(r => ({ id: r.id, live: r.live, liveDetail: r.liveDetail, fields: r.fields,
        saved: r.savedFields, migrated: r.migratedFields, unsupported: r.unsupported })),
      holdoutFailing: failingCore.filter(r => r.holdout).length, expected: expectedCore.length, unwritten: unwritten.length },
    population: population, allowlist: allowlist,
    corpus: { files: res.corpus.length, readErrors: res.corpus.filter(r => r.readError).length,
      exact: res.corpus.filter(r => !r.readError && (!r.fields || !r.fields.length)).length, knownLosses: corpusKnown.length,
      projectedLinked: res.corpus.filter(r => r.projLink).length,
      known: corpusKnown.map(r => r.id.split('/').pop() + ' ' + CORPUS_KNOWN_LOSS[r.id].code),
      failing: corpusBad.map(r => ({ id: r.id, readError: r.readError, fields: r.fields, unsupported: r.unsupported })) },
    omr: res.omr.map(r => ({ id: r.id, exact: exact(r.fields, r.unsupported), fields: r.fields, linked: r.projLink, unsupported: r.unsupported }))
  };
  console.log(JSON.stringify(summary, null, 1));
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify({ summary: summary, rows: { core: core.filter(r => !r.holdout), corpus: res.corpus, omr: res.omr } }, null, 1));
  const bad = failingCore.length + corpusBad.length + omrBad.length + population.length + allowlist.length;
  console.log(bad ? 'A48 page gate: FAIL (' + failingCore.length + ' core, ' + corpusBad.length + ' corpus, ' + omrBad.length + ' OMR, ' +
      population.length + ' population, ' + allowlist.length + ' allowlist)'
    : 'A48 page gate: PASS - core ' + core.length + '/' + EXPECTED.core + ' (live, projected, saved, migrated) exact; corpus ' + res.corpus.length + '/' +
      EXPECTED.corpus + ' (' + corpusKnown.length + ' known losses); OMR ' + res.omr.length);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
