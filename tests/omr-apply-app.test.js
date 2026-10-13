/* ============================================================================
   G12-2 in the real page: PPP.omr = 'v2' makes an OMR import a ScoreGraph (docs/GOALS/G12_OMR.md section 7.2, 7.3, gate A2).
   Browser suite (puppeteer); not a step of the gate (the gate has no browser): `npm run test:omr-apply-app`, against a server of THIS tree
   (tests/engrave/tools/with-port.js: PPP_PORT=8801 NODE_ENV=production node server.js). It reads pdf.js from the CDN the page reads it from.

   The helper is stood in for in the page (PPP.Import.health / .recognise return the pages the engine would have written), so what runs is the page's own
   Import.load, the real omr/normalize.js and omr/apply.js fetched the way the page fetches them, the real PdfLayer on a hand-written PDF
   (tests/omr-apply-fixture.js: every finding PdfLayer.apply makes), and the engraver's own source (PPPEngrave.app.resolveSync: does the graph agree with the Score).

   What this checks:
     - legacy never asks for omr/apply.js, and returns no graph; v2 asks for it once, and returns the graph it kept
     - the differential: on the page with every kind of finding, the Score a v2 import makes (the graph with the findings as edits, then toScore) is the
       Score the legacy import makes (parseMusicXML, then PdfLayer.apply on it): same notes, pitches, accidentals, arpeggios, hands, chord names, marks,
       8va brackets, title, composer, tempo; and PdfLayer.apply saw the same page (the same counts)
     - the graph the engraver draws IS the import's graph (via 'live', agree.ok), where the legacy import's is a projection of the Score (via 'projected'): E10
     - the beams Audiveris wrote are in the graph and in the engraver's plan
     - the edits are provenance-marked, the Score's hands never silence a staff, the song's graph is kept (hasLive)
     - zero-length rests and hairpins that end where they start (the normaliser) are imported
     - v2 that cannot get omr/apply.js, whose graph import refuses the document, or whose PdfLayer.apply throws: what each leaves
   ============================================================================ */
'use strict';
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const FX = require('./omr-apply-fixture.js');
const L = require('./omr/normalize/lib.js');
const SC = require('./omr/normalize/scenarios.js');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const short = x => { const s = typeof x === 'string' ? x : JSON.stringify(x); return s.length > 700 ? s.slice(0, 700) + '...' : s; };

/* a page of beamed eighths and a zero-length rest and a hairpin that ends where it starts, as the engine writes them */
const wedge = (type) => '<direction placement="below"><direction-type><wedge type="' + type + '" spread="0"/></direction-type><staff>1</staff></direction>';
const eighths = ['C', 'D', 'E', 'F'].map((s, i) => '<note default-x="' + (20 + i * 30) + '"><pitch><step>' + s + '</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>' +
  '<beam number="1">' + (i % 2 ? 'end' : 'begin') + '</beam><staff>1</staff></note>').join('');
const BEAMED = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0.3"><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification>' +
  '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' +
  '<measure number="1" width="200"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves>' +
  '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
  eighths + '<backup><duration>4</duration></backup><note default-x="20"><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note></measure>' +
  /* a bar the engine read nothing in: a whole-bar rest of length 0, on both staves */
  '<measure number="2" width="100"><note><rest measure="yes"/><duration>0</duration><voice>1</voice><staff>1</staff></note><note><rest measure="yes"/><duration>0</duration><voice>5</voice><staff>2</staff></note></measure>' +
  /* a crescendo and a diminuendo that meet: start, start, stop, stop with no note between the middle two */
  '<measure number="3" width="200">' +
  '<note default-x="20"><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>' + wedge('crescendo') +
  '<note default-x="60"><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>' + wedge('diminuendo') + wedge('stop') + wedge('stop') +
  '<backup><duration>4</duration></backup><note default-x="20"><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note></measure>' +
  '</part></score-partwise>';
const PNG = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'piano-clean.png')).toString('base64');

/* in the page: stand in for the helper with the pages the engine would have written, then run Import.load on a file */
const IN_PAGE = `
  window.__import = async function (kind, bodyXml, mode, opts) {
    const I = window.PPP.Import;
    window.PPP.omr = mode;
    I.health = async () => ({ ok: true, audiveris: true });
    const docs = Array.isArray(bodyXml) ? bodyXml : [bodyXml];
    I.recognise = async () => ({ ok: true, engine: 'Audiveris', pages: docs.map((_, i) => ({ index: i, ok: true })), musicxml: docs.slice(), movements: docs.map(d => [d]) });
    let file;
    if (kind === 'pdf') {
      const bin = atob(opts.pdf), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      file = new File([u], 'vector.pdf', { type: 'application/pdf' });
    } else {
      const bin = atob(opts.png), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      file = new File([u], 'page.png', { type: 'image/png' });
    }
    try { return { r: await I.load(file, null, { cancelled: false }) }; } catch (e) { return { error: String(e && e.message || e) }; }
  };
  window.__view = function (score) {
    const key = n => [n.m, Math.round(n.b * 1e4) / 1e4, n.staff || 1, n.p, n.writtenP || '', n.acc || '', n.arp ? 'arp' : '', n.hand].join('|');
    return {
      notes: score.notes.filter(n => !n.rest).map(key).sort(),
      rests: score.notes.filter(n => n.rest).map(n => [n.m, Math.round(n.b * 1e4) / 1e4, n.staff || 1, Math.round(n.dur * 1e4) / 1e4].join('|')).sort(),
      chords: (score.chords || []).map(c => c.m + '|' + Math.round(c.b * 1e4) / 1e4 + '|' + c.text).sort(),
      marks: (score.marks || []).map(k => k.m + ':' + k.kind + (k.text ? '(' + k.text + ')' : '')).sort(),
      ottavas: (score.ottavas || []).map(o => [o.m, Math.round(o.b * 1e4) / 1e4, o.endM, o.dir, o.size, o.staff].join('|')),
      under: score.notes.filter(n => n.ottavaShift).map(n => n.m + '|' + n.b + '|' + n.ottavaShift).sort(),
      title: score.title, composer: score.composer, tempo: score.tempo, measures: score.measures.length, staves: score.staves
    };
  };
`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fresh = async (intercept) => {
    const page = await browser.newPage();
    await preparePage(page);
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    const asked = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/omr\/(normalize|apply)\.js/.test(u)) { asked.push(u.replace(/^.*\/omr\//, 'omr/')); if (intercept && intercept.test(u)) return req.abort('failed'); }
      req.continue();
    });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPP.Import.load && window.PPP.Import.omrS4, { timeout: 30000 });
    await page.evaluate(IN_PAGE);
    await page.addScriptTag({ url: PDFJS });
    await page.evaluate(w => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = w; }, PDFJS_WORKER);
    return { page, asked };
  };
  const pdf = FX.makePdf();

  /* ---------------------------------------------------------------- legacy and v2 on the page with every finding */
  console.log('the differential: the page with every kind of finding, legacy and v2');
  {
    const { page, asked } = await fresh();
    const legacy = await page.evaluate(async (pdfB64, xml) => {
      const o = await window.__import('pdf', xml, 'legacy', { pdf: pdfB64 });
      if (o.error) return { error: o.error };
      const r = o.r;
      return { view: window.__view(r.score), fromPdf: r.source.fromPdf, hasGraph: 'graph' in r, via: window.PPPEngrave.app.resolveSync(r.score).via,
        keys: Object.keys(r).sort(), normalize: !!r.report.normalize, issues: r.report.issues.length, level: r.report.level };
    }, pdf, FX.XML);
    ok('legacy imports the page', !legacy.error && legacy.view && legacy.view.measures === 3, short(legacy.error || legacy.view && legacy.view.measures));
    ok('legacy asked for neither omr/normalize.js nor omr/apply.js', asked.length === 0, short(asked));
    ok('legacy returns no graph and no report.graph', legacy.hasGraph === false && legacy.keys.join() === 'musicxml,pageImages,report,score,source');
    ok('PdfLayer.apply found everything the fixture holds (legacy)', legacy.fromPdf && legacy.fromPdf.phantoms === 1 && legacy.fromPdf.accidentals === 1 && legacy.fromPdf.arpeggios === 1
      && legacy.fromPdf.realigned === 1 && legacy.fromPdf.ottavas === 1 && legacy.fromPdf.chords === 5 && legacy.fromPdf.marks === 4 && legacy.fromPdf.title === true && legacy.fromPdf.tempo === true,
      short(legacy.fromPdf));
    ok('the legacy engraver draws a projection of the Score, not the import\'s graph (E10)', legacy.via === 'projected', legacy.via);
    await page.close();

    const f = await fresh();
    const v2 = await f.page.evaluate(async (pdfB64, xml) => {
      const o = await window.__import('pdf', xml, 'v2', { pdf: pdfB64 });
      if (o.error) return { error: o.error };
      const r = o.r;
      const src = window.PPPEngrave.app.resolveSync(r.score);
      const g = r.graph;
      const prov = [];
      g.provenance.sources.forEach(s => { if (s.kind === 'omr') prov.push(s.tool); });
      return { view: window.__view(r.score), fromPdf: r.source.fromPdf, hasGraph: !!g, via: src.via, agree: src.agree && src.agree.ok, producer: src.producer,
        graphSame: src.graph === g, live: window.PPPEngrave.app.hasLive(r.score), keys: Object.keys(r).sort(), reportGraph: r.report.graph, normalize: !!r.report.normalize,
        issues: r.report.issues.length, level: r.report.level, marked: g.ext && g.ext['ppp.omr'], prov: prov, importReport: r.source.importReport && { format: r.source.importReport.format, counts: r.source.importReport.counts },
        inferred: g.parts[0].events.filter(e => e.prov && e.prov.asp).length, rev: g.rev, hands: Array.from(new Set(r.score.notes.map(n => n.hand))).sort().join() };
    }, pdf, FX.XML);
    ok('v2 imports the page', !v2.error && v2.view && v2.view.measures === 3, short(v2.error || v2.view && v2.view.measures));
    ok('v2 asked for omr/normalize.js and omr/apply.js once each', f.asked.filter(u => /normalize/.test(u)).length === 1 && f.asked.filter(u => /apply/.test(u)).length === 1, short(f.asked));
    ok('v2 returns the graph it made and kept (hasLive), marked as an OMR graph, with the source omr / pdflayer', v2.hasGraph && v2.live && v2.marked && v2.marked.hands === 'by-staff' && v2.prov.join() === 'pdflayer', short([v2.hasGraph, v2.live, v2.marked, v2.prov]));
    ok('the engraver draws the import\'s own graph: via live, it agrees with the Score, nothing is projected', v2.via === 'live' && v2.agree === true && v2.graphSame && v2.producer === 'omr', short([v2.via, v2.agree, v2.graphSame, v2.producer]));
    ok('PdfLayer.apply saw the same page as for legacy (the same counts of findings)', JSON.stringify(v2.fromPdf) === JSON.stringify(legacy.fromPdf), short([v2.fromPdf, legacy.fromPdf]));
    ok('the findings were applied as graph edits, none skipped', v2.reportGraph && v2.reportGraph.skipped.length === 0 && v2.reportGraph.conflicts === 0 && v2.reportGraph.findings.total >= 12, short(v2.reportGraph));
    ok('report.graph lists what the page took away (the phantom note) and what the work cost (one validation)', v2.reportGraph.removed && v2.reportGraph.removed.events === 1 && v2.reportGraph.removed.heads === 1 && v2.reportGraph.removed.list[0].pitches.join() === 'E5'
      && v2.reportGraph.work && v2.reportGraph.work.validations === 1, short([v2.reportGraph.removed, v2.reportGraph.work]));
    ok('the edited entities carry provenance (events moved by a finding are inferred)', v2.inferred >= 2, String(v2.inferred));
    ok('report.normalize is there, the import report is kept for the song', v2.normalize && v2.importReport && v2.importReport.format === 'musicxml' && v2.importReport.counts.measures === 3, short(v2.importReport));
    for (const k of ['notes', 'rests', 'chords', 'marks', 'ottavas', 'under']) {
      ok('the same ' + k + ' as legacy', JSON.stringify(v2.view[k]) === JSON.stringify(legacy.view[k]), JSON.stringify(v2.view[k]) === JSON.stringify(legacy.view[k]) ? '' : short({ v2: v2.view[k], legacy: legacy.view[k] }));
    }
    ok('the same title, composer, tempo, bars, staves', ['title', 'composer', 'tempo', 'measures', 'staves'].every(k => v2.view[k] === legacy.view[k]), short([v2.view.title, v2.view.composer, v2.view.tempo, legacy.view.title, legacy.view.composer, legacy.view.tempo]));
    ok('the same confidence and the same flagged bars', v2.issues === legacy.issues && v2.level === legacy.level, short([v2.issues, legacy.issues, v2.level, legacy.level]));
    ok('no staff is silent', v2.hands === 'l,r', v2.hands);
    await f.page.close();
  }

  /* ---------------------------------------------------------------- beams, zero-length rests, a degenerate hairpin: a page of the kind the engine writes */
  console.log('beams, a zero-length rest and a hairpin that ends where it starts');
  {
    const { page } = await fresh();
    const run = async mode => page.evaluate(async (xml, mode, png) => {
      const o = await window.__import('image', xml, mode, { png: png });
      if (o.error) return { error: o.error };
      const r = o.r, src = window.PPPEngrave.app.resolveSync(r.score);
      const plan = src.graph ? window.PPPEngrave.plan(src.graph) : null;
      const beams = plan ? plan.beams : [];
      const beamed = new Set(); beams.forEach(b => { if (b.source === 'graph' && !b.deferred) b.events.forEach(e => beamed.add(e)); });
      return { bars: r.score.measures.length, via: src.via, agree: src.agree && src.agree.ok, graphBeams: src.graph ? src.graph.parts.reduce((s, p) => s + p.spanners.filter(x => x.type === 'beam').length, 0) : 0,
        drawn: beams.filter(b => b.source === 'graph').length, beamedEvents: beamed.size, normalize: r.report.normalize && r.report.normalize.counts,
        rests: r.score.notes.filter(n => n.rest && n.m === 2).map(n => n.staff + ':' + n.dur), lens: r.score.measures.map(m => m.lenQ).join(), restAt: r.score.notes.filter(n => n.rest && n.m === 2).map(n => n.staff + ':' + n.b + ':' + n.dur).join(), wedges: src.graph ? src.graph.parts.reduce((s, p) => s + p.spanners.filter(x => x.type === 'wedge').length, 0) : -1,
        failed: r.report.graphFailed || null, hands: Array.from(new Set(r.score.notes.map(n => n.hand))).sort().join() };
    }, BEAMED, mode, PNG);
    const v2 = await run('v2');
    ok('v2 imports a page with a zero-length rest and a hairpin that ends where it starts (the importer refused both before the normaliser mended them)', !v2.error && v2.bars === 3 && !v2.failed, short(v2));
    ok('the normaliser says what it did', v2.normalize && v2.normalize.zeroDurationsRepaired === 2 && v2.normalize.wedgesDegenerate === 1 && v2.normalize.wedgesDropped === 4, short(v2.normalize));
    ok('both whole-bar rests last the bar (2/4 = 2 quarters) and start with it: no bar is doubled, no later bar plays a bar late', v2.rests.join() === '1:2,2:2' && v2.restAt === '1:0:2,2:0:2' && v2.lens === '2,2,2', short([v2.rests, v2.restAt, v2.lens]));
    ok('the normaliser counts rests and pitched notes apart, and the <backup> it wrote', v2.normalize.zeroRestsRepaired === 2 && v2.normalize.zeroNotesRepaired === 0 && v2.normalize.zeroRestBackups === 1 && v2.normalize.zeroRestsRefused === 0, short(v2.normalize));
    ok('no hairpin is left', v2.wedges === 0);
    ok('the beams Audiveris wrote are in the graph and drawn from it (2 beams over 4 eighths)', v2.graphBeams === 2 && v2.drawn === 2 && v2.beamedEvents === 4, short([v2.graphBeams, v2.drawn, v2.beamedEvents]));
    ok('the graph agrees with the Score', v2.via === 'live' && v2.agree === true, short([v2.via, v2.agree]));
    ok('no staff is silent', v2.hands === 'l,r', v2.hands);
    const legacy = await run('legacy');
    ok('legacy reads the same page (the control)', !legacy.error && legacy.bars === 3, short(legacy));
    ok('and has the same bar lengths as v2 (a zero-length bar falls back to the time signature in the legacy reader)', legacy.lens === v2.lens, short([legacy.lens, v2.lens]));
    await page.close();
  }

  /* ---------------------------------------------------------------- when v2 cannot do all of it */
  console.log('v2 that cannot get omr/apply.js, whose graph import refuses the document, or whose PdfLayer.apply throws');
  {
    const a = await fresh(/omr\/apply\.js/);
    const blocked = await a.page.evaluate(async (pdfB64, xml) => {
      const o = await window.__import('pdf', xml, 'v2', { pdf: pdfB64 });
      if (o.error) return { error: o.error };
      const r = o.r;
      return { bars: r.score.measures.length, graph: 'graph' in r, failed: r.report.graphFailed || null, normalize: !!r.report.normalize, hands: Array.from(new Set(r.score.notes.map(n => n.hand))).sort().join(),
        flat: r.score.notes.filter(n => n.acc === 'flat').length, via: window.PPPEngrave.app.resolveSync(r.score).via };
    }, pdf, FX.XML);
    ok('without omr/apply.js the import is what G12-1\'s v2 makes (the legacy reader, the normalised document), and says why',
      !blocked.error && blocked.bars === 3 && blocked.graph === false && blocked.failed === 'apply-not-loaded' && blocked.normalize && blocked.flat === 1, short(blocked));
    await a.page.close();

    const b = await fresh();
    /* a document the legacy reader takes and the ScoreGraph importer refuses: a note that sounds above MIDI 127 (E-PITCH-RANGE) */
    const dup = BEAMED.replace('<step>C</step><octave>5</octave>', '<step>C</step><octave>10</octave>');
    const refused = await b.page.evaluate(async (xml, png) => {
      const o = await window.__import('image', xml, 'v2', { png: png });
      if (o.error) return { error: o.error };
      const r = o.r;
      return { bars: r.score.measures.length, graph: 'graph' in r, failed: r.report.graphFailed || null, notes: r.score.notes.filter(n => !n.rest).length };
    }, dup, PNG);
    ok('a document the graph importer refuses leaves the legacy import, and says why (graphFailed)', !refused.error && refused.graph === false && /IMPORT-INVALID/.test(refused.failed || '') && refused.bars === 3, short(refused));

    const c = await fresh();
    const thrown = await c.page.evaluate(async (pdfB64, xml) => {
      window.PPP.PdfLayer.apply = () => { throw new Error('boom'); };
      const o = await window.__import('pdf', xml, 'v2', { pdf: pdfB64 });
      if (o.error) return { error: o.error };
      const r = o.r, src = window.PPPEngrave.app.resolveSync(r.score);
      return { bars: r.score.measures.length, graph: !!r.graph, reportGraph: r.report.graph, via: src.via, fromPdf: r.source.fromPdf || null, flat: r.score.notes.filter(n => n.acc === 'flat').length };
    }, pdf, FX.XML);
    ok('a PdfLayer.apply that throws leaves the recognised graph as it is, and says so', !thrown.error && thrown.bars === 3 && thrown.graph && thrown.reportGraph && /boom/.test(thrown.reportGraph.error || '') && thrown.via === 'live' && thrown.flat === 0, short(thrown));
    /* the layers are asked for inside the fallback: a page that cannot give them is a fallback, not an exception */
    const guard = await c.page.evaluate(async xml => {
      window.PPP.omr = 'v2';
      const omr = { normalize: {}, engine: 'Audiveris' };
      let r, threw = false;
      try { r = await window.PPP.Import.omrS4(omr, xml, 'n.png', () => { throw new Error('no layers'); }, null); } catch (e) { threw = true; }
      return { r: r === null, threw: threw, failed: omr.graphFailed || null };
    }, FX.XML);
    ok('a page that cannot give its layers is a fallback, not an exception (omrS4 returns null and says why)', !guard.threw && guard.r === true && /no layers/.test(guard.failed || ''), short(guard));
    await c.page.close();
  }

  await browser.close();
  console.log(errors.length ? '\n' + errors.length + ' FAILED:\n  ' + errors.join('\n  ') : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
