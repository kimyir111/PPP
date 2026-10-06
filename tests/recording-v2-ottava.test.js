/* ============================================================================
   G10a-6: automatic 8va/8vb for the recording conversion v2, in the real page (docs/GOALS/G10_AUDIO_TO_SCORE.md section 29)

   A recording's notes can sound far above or below the staff (the teacher's six real covers: 7-15% of the heard notes at or above E6); printed on ledger lines they cannot be read. With
   PPP.recording = 'v2' the conversion puts realize/ottava.js's octave lines on the graph (audio-score.js, opts.ottava, on by default under v2 and 'off' / false to go without). What this checks, in the
   real page and the real screens (the transcription model is a stub that returns heard notes made from numbers, tests/recording-v2-fixtures.js crossLines; PPP_HEARD_FILE=<heard.json> runs the same
   flow on any recording's heard notes instead, for a private check; everything after the notes is the real app):
     - the lines are there: the Score the review screen holds has octave lines, the graph the page draws has the same ones, the engraver draws them (g.ppp-ottava), and no head needing 3 or more ledger lines
       that a line could cover is left on them (scoregraph/tools/ledger-stats.js)
     - the music is the same: the sounding pitch of every note (midi, soundingMidi), every onset and length, and every strike of the player equal the conversion made with the lines off; written = sounding - shift
       (MX-1); the notation checker's classes 1-7 stay 0 in the Score and the graph, the validator has no error and no W-OTTAVA-OVERLAP
     - Accept, a reload and "open from My Songs": the saved song has its lines (the graph from the store, via 'store'), the same Score; "Write the notation again" with v2 gives the same lines, with the classic
       method none (the classic conversion is untouched), and Undo puts the lines back exactly
     - the Song Arranger's one-note copy of a v2 graph is the same copy with or without the lines on its input (notes and its own lines), valid, with no overlapping lines (nothing is applied twice)
     - opts.ottava: off, false, 'off' keep the graph without lines; the classic conversion ignores the option; a page that cannot fetch realize/ottava.js still writes the v2 score (without lines), no page error
     - the file: asked for with the stages' files (and once, with the same address the arranger asks), not by a page that never selects v2 until a screen that converts opens

   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build. node tests/recording-v2-ottava.test.js
   ========================================================================== */
'use strict';
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const F = require('./recording-v2-fixtures');
const L = require('./recording-v2-lib');
const { fs, path, REPO, errors, sleep, ok, setBase, openPage, clean, errs, addChecker, importHeard, press, stateOf, drawSound, accept, slotOf, want } = L;

const heardFile = process.env.PPP_HEARD_FILE;
const HEARD = heardFile ? JSON.parse(fs.readFileSync(heardFile, 'utf8')) : F.crossLines(9);

/* in the page: the ledger-line tool is a tool, not part of the app */
const addLedger = page => page.addScriptTag({ url: new URL(page.url()).origin + '/scoregraph/tools/ledger-stats.js' });
/* what the open song says about its octave lines, in the Score, the graph and the engraved page */
const lines = page => page.evaluate(() => {
  const A = window.PPP.app, sc = A.state.score, rs = window.PPPEngrave.app.resolveSync(sc), g = rs.graph, LS = window.PPPScoreGraphModules.ledgerStats;
  const spans = [];
  g.parts.forEach(p => p.spanners.forEach(s => { if (s.type === 'ottava') spans.push([s.staff, s.shift, s.from.m, s.from.at, s.to.m, s.to.at].join(',')); }));
  const under = sc.notes.filter(n => !n.rest && n.ottavaShift);
  const V = window.PPPScoreGraph.validate(g);
  const stats = LS.ledgerStats(g), plain = LS.ledgerStats(g, { display: false });
  return {
    scoreLines: (sc.ottavas || []).length, scoreLineList: (sc.ottavas || []).map(o => [o.m, o.b, o.endM, o.endB, o.staff, o.semitones].join(',')).join(';'), graphLines: spans.length, graphList: spans.join(';'),
    under: under.length, soundingKept: under.every(n => n.midi === n.soundingMidi && n.writtenMidi === n.midi - n.ottavaShift && Math.abs(n.ottavaShift) % 12 === 0), via: rs.via,
    heads: stats.heads, ge3: stats.ge3, ge3Plain: plain.ge3, hist: stats.hist, histPlain: plain.hist, shiftedHeads: stats.shifted,
    errors: V.issues.filter(i => i.severity === 'error').map(i => i.code), overlap: V.issues.filter(i => i.code === 'W-OTTAVA-OVERLAP').length,
    drawn: document.querySelectorAll('g.ppp-ottava').length, pipeline: A.state.importSource && A.state.importSource.recordingPipeline || null
  };
});
/* the same heard notes through the page's conversion with the lines off (a control), read the way the page reads a conversion: its Score and the player's strikes */
const control = page => page.evaluate(() => {
  const h = window.__heard, P = window.PPP;
  const input = { notes: h.notes.map(n => Object.assign({}, n)), pedals: (h.pedals || []).map(p => Object.assign({}, p)), title: 'x' };
  const r = window.PPPAudioScore.toMusicXml(input, { title: 'x', closeGaps: true, exactBars: true, recording: 'v2', ottava: 'off' });
  const sc = P.parseMusicXML(r.xml, 'x');
  return { notes: JSON.stringify(sc.notes.filter(n => !n.rest).map(n => [n.m, n.b, n.midi, n.dur, n.staff])), strikes: JSON.stringify(P.PianoScore.of(sc).strikes.map(s => [Math.round(s.abs * 1000), s.midi, Math.round((s.upQ - s.q) * 1000)])),
    lines: (sc.ottavas || []).length, graphLines: r.graph.parts.reduce((a, p) => a + p.spanners.filter(s => s.type === 'ottava').length, 0), report: r.ottavaReport || null };
});
const mine = page => page.evaluate(() => {
  const P = window.PPP, sc = P.app.state.score;
  return { notes: JSON.stringify(sc.notes.filter(n => !n.rest).map(n => [n.m, n.b, n.midi, n.dur, n.staff])), strikes: JSON.stringify(P.PianoScore.of(sc).strikes.map(s => [Math.round(s.abs * 1000), s.midi, Math.round((s.upQ - s.q) * 1000)])) };
});

(async () => {
  const srv = await startServer();
  setBase(srv.url);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  try {
    if (want('flow')) {
    console.log('\n── v2: the lines on the review screen, the music the same ──');
    const pg = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await addChecker(pg); await addLedger(pg);
    const imp = await importHeard(pg, HEARD);
    ok('the import reached the review screen', imp.screen === 'review' && !imp.error, JSON.stringify(imp));
    const s0 = await stateOf(pg);
    const o0 = await lines(pg);
    ok('written by v2, with octave lines in the Score and in the graph, the same ones (' + o0.scoreLines + ' and ' + o0.graphLines + ')', o0.pipeline === 'v2' && o0.scoreLines > 0 && o0.scoreLines === o0.graphLines && o0.under > 0, JSON.stringify({ p: o0.pipeline, s: o0.scoreLines, g: o0.graphLines, u: o0.under }));
    ok('the graph is the Score\'s own (via live), valid, with no overlapping lines', o0.via === 'live' && o0.errors.length === 0 && o0.overlap === 0, JSON.stringify({ via: o0.via, e: o0.errors, o: o0.overlap }));
    ok('the notation checker\'s classes 1-7 are 0 in the Score and in the graph', Object.values(s0.scoreClasses).every(v => v === 0) && Object.values(s0.graphClasses).every(v => v === 0), JSON.stringify({ sc: s0.scoreClasses, gc: s0.graphClasses }));
    ok('every note under a line keeps the pitch it sounds (midi = soundingMidi) and is written whole octaves away (MX-1)', o0.soundingKept);
    ok('heads on 3 or more ledger lines: ' + o0.ge3Plain + ' without the lines, ' + o0.ge3 + ' with them (' + o0.shiftedHeads + ' heads drawn under a line)', o0.ge3Plain > 0 && o0.ge3 < o0.ge3Plain && o0.ge3 * 4 <= o0.ge3Plain, JSON.stringify({ with: o0.hist, without: o0.histPlain }));
    const c0 = await control(pg), m0 = await mine(pg);
    ok('the control (the same heard notes, lines off) has none and the page\'s conversion has the same notes, onsets, lengths, staves and sounding pitches as it', c0.lines === 0 && c0.graphLines === 0 && c0.report === null && m0.notes === c0.notes, JSON.stringify({ cl: c0.lines, cg: c0.graphLines }));
    ok('and the player strikes the same notes at the same places for the same lengths', m0.strikes === c0.strikes, 'strikes ' + JSON.parse(m0.strikes).length);
    /* the review screen itself: four bars from the first bar with a line, drawn by the engraver with the line over them (and none from a bar before any line) */
    const rv = await pg.evaluate(async () => {
      const A = window.PPP.app, sc = A.state.score, first = (sc.ottavas || []).map(o => o.m).sort((a, b) => a - b)[0], out = { first: first };
      A.setState({ reviewFrom: first });
      await new Promise(r => setTimeout(r, 1500));
      const box = document.querySelector('[data-review-score]');
      out.drawn = box ? box.querySelectorAll('g.ppp-ottava').length : -1;
      out.heads = box ? box.querySelectorAll('path.vf-notehead:not(.vf-rest), use.vf-notehead:not(.vf-rest)').length : -1;
      return out;
    });
    ok('the review screen draws the line over the bars it shows (from bar ' + rv.first + ': ' + rv.drawn + ' marks, ' + rv.heads + ' heads)', rv.drawn > 0 && rv.heads > 0, JSON.stringify(rv));
    const ds = await drawSound(pg);
    const od = await lines(pg);
    ok('the practice screen draws the lines (g.ppp-ottava: ' + od.drawn + '), every sounded note is a written one and every drawn head a Score note', od.drawn > 0 && ds.onlyWritten === 0 && ds.onlySounded === 0 && ds.heads === ds.notes && ds.tooShort === 0, JSON.stringify({ drawn: od.drawn, ds: ds }));
    ok('no page or console error', clean(pg), errs(pg));

    console.log('\n── the Song Arranger\'s one-note copy: the same with or without the lines on its input, nothing applied twice ──');
    const arr = await pg.evaluate(async () => {
      const P = window.PPP, S = P.app.state, g = window.PPPEngrave.app.resolveSync(S.score).graph, h = window.__heard;
      const off = window.PPPAudioScore.toMusicXml({ notes: h.notes.map(n => Object.assign({}, n)), pedals: (h.pedals || []).map(p => Object.assign({}, p)), title: 'x' },
        { title: 'x', closeGaps: true, exactBars: true, recording: 'v2', ottava: 'off' }).graph;
      const notes = r => JSON.stringify(r.graph.parts.reduce((a, p) => a.concat(p.events.filter(e => e.kind === 'note').reduce((b, e) => b.concat(e.heads.map(x => [e.m, e.at, e.dur, x.staff || e.staff, x.pitch.step, x.pitch.alter, x.pitch.oct].join('|'))), [])), []).sort());
      const sp = r => r.graph.parts.reduce((a, p) => a.concat(p.spanners.filter(s => s.type === 'ottava').map(s => [s.staff, s.shift, s.from.m, s.from.at, s.to.m, s.to.at].join(','))), []);
      const out = {};
      for (const lv of ['beginner', 'intermediate']) {
        const a = await P.arrangeSingleNote(g, { level: lv }), b = await P.arrangeSingleNote(off, { level: lv });
        out[lv] = { okA: a.ok, okB: b.ok, reasonA: a.reason || null, reasonB: b.reason || null };
        if (a.ok && b.ok) {
          const V = window.PPPScoreGraph.validate(a.graph);
          out[lv].same = notes(a) === notes(b); out[lv].sameLines = JSON.stringify(sp(a)) === JSON.stringify(sp(b)); out[lv].lines = sp(a).length;
          out[lv].overlap = V.issues.filter(i => i.code === 'W-OTTAVA-OVERLAP').length; out[lv].errors = V.issues.filter(i => i.severity === 'error').length;
          out[lv].ge3 = window.PPPScoreGraphModules.ledgerStats.ledgerStats(a.graph).ge3;
          out[lv].review = P.graphToReviewScore(a.graph, 'x').ottavas.length;
        }
      }
      return out;
    });
    Object.keys(arr).forEach(lv => {
      const a = arr[lv];
      ok('the one-note copy (' + lv + ') of the v2 graph ' + (a.okA ? 'is made' : 'is refused (' + a.reasonA + ')') + ' and is the copy of the same graph without lines: ' + (a.okA ? 'notes ' + a.same + ', its own lines ' + a.sameLines + ' (' + a.lines + ')' : ''),
        a.okA === a.okB && a.reasonA === a.reasonB && (!a.okA || (a.same && a.sameLines && a.overlap === 0 && a.errors === 0 && a.review === a.lines)), JSON.stringify(a));
    });
    /* the committed fixture is arranged; a recording the one-note arranger refuses (the hands of 25.4) is refused the same way with and without lines, which the per-level check above holds */
    if (!heardFile) ok('at least one level was arranged', Object.values(arr).some(a => a.okA), JSON.stringify(arr));

    console.log('\n── Accept, a reload, My Songs; Write the notation again and Undo ──');
    await pg.evaluate(() => window.PPP.app.setState({ screen: 'review' })); await sleep(500);
    await accept(pg);
    const sid = s0.songId;
    ok('Accept saves the song with the mark', !!(await slotOf(pg, sid)) && (await slotOf(pg, sid)).importSource.recordingPipeline === 'v2');
    await sleep(2500);
    await pg.reload({ waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => !!(window.PPP && window.PPP.app)); await sleep(800);
    await addChecker(pg); await addLedger(pg);
    await pg.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
    await pg.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, sid); await sleep(3000);
    await stateOf(pg);
    const o1 = await lines(pg);
    ok('after a reload the saved song has its lines: the graph from the store, the same Score lines, the same graph lines', o1.via === 'store' && o1.scoreLineList === o0.scoreLineList && o1.graphList === o0.graphList && o1.under === o0.under && o1.errors.length === 0 && o1.overlap === 0,
      JSON.stringify({ via: o1.via, same: o1.scoreLineList === o0.scoreLineList, g: o1.graphList === o0.graphList }));
    const m1 = await mine(pg);
    ok('and the same notes and strikes', m1.notes === m0.notes && m1.strikes === m0.strikes);
    const sr = await stateOf(pg);
    ok('classes 1-7 stay 0 after the reload', Object.values(sr.scoreClasses).every(v => v === 0) && Object.values(sr.graphClasses).every(v => v === 0), JSON.stringify(sr.scoreClasses));
    await pg.evaluate(() => { window.PPP.recording = 'v2'; window.PPP.app.setState({ screen: 'review' }); }); await sleep(800);
    await pg.evaluate(() => window.PPP.loadRecordingModules());
    await press(pg, '[data-write-again]');
    await pg.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation, { timeout: 60000 });
    await sleep(1500);
    const o2 = await lines(pg), m2 = await mine(pg);
    /* the heard notes of a kept graph are its performance layer: on a real piece the conversion of them can lose a note the review's own did not have (p5: one, with the lines off as well, so not this
       phase's); the committed fixture loses none, a private piece may lose a note or two, and the lines are what this phase asserts */
    const lost = JSON.parse(m0.notes).length - JSON.parse(m2.notes).length;
    ok('Write the notation again with v2 (from the kept graph): the same lines' + (heardFile ? ' (' + lost + ' notes lost of ' + JSON.parse(m0.notes).length + ')' : ', notes and strikes'),
      o2.pipeline === 'v2' && o2.scoreLineList === o0.scoreLineList && o2.graphList === o0.graphList && (heardFile ? lost >= 0 && lost <= 2 : m2.notes === m0.notes && m2.strikes === m0.strikes),
      JSON.stringify({ p: o2.pipeline, sl: o2.scoreLines, gl: o2.graphLines, lost: lost }));
    await pg.evaluate(() => { window.PPP.recording = 'legacy'; window.PPP.app.setState({ recordingTick: 2 }); }); await sleep(300);
    await press(pg, '[data-write-again]');
    await pg.waitForFunction(() => !window.PPP.app.state.recWriteBusy && window.PPP.app.state.recNotation && window.PPP.app.state.recNotation.method !== 'v2', { timeout: 60000 });
    await sleep(1500);
    const o3 = await lines(pg), m3 = await mine(pg);
    ok('Write the notation again with the classic method: no lines at all (the classic conversion is untouched), the sounding notes the same pitches', o3.pipeline === null && o3.scoreLines === 0 && o3.graphLines === 0 && o3.under === 0 && o3.drawn === 0 && o3.ge3 === o3.ge3Plain, JSON.stringify({ p: o3.pipeline, s: o3.scoreLines, g: o3.graphLines, ge3: o3.ge3 }));
    const top = j => JSON.parse(j).reduce((m, n) => Math.max(m, n[2]), 0), bottom = j => JSON.parse(j).reduce((m, n) => Math.min(m, n[2]), 127);
    ok('and its notes sound where the heard ones do: the classic Score has the same highest and lowest sounding pitches as v2 (' + bottom(m3.notes) + ' to ' + top(m3.notes) + ')', JSON.parse(m3.notes).length > 0 && top(m3.notes) === top(m0.notes) && bottom(m3.notes) === bottom(m0.notes));
    await press(pg, '[data-notation-undo]'); await sleep(2500);
    const o4 = await lines(pg), m4 = await mine(pg);
    ok('Undo puts the v2 notation of before back with its lines exactly (the Score\'s lines, the graph\'s lines, the notes and the strikes)', o4.pipeline === 'v2' && o4.scoreLineList === o2.scoreLineList && o4.graphList === o2.graphList && m4.notes === m2.notes && m4.strikes === m2.strikes,
      JSON.stringify({ p: o4.pipeline, sl: o4.scoreLines, gl: o4.graphLines, same: o4.graphList === o2.graphList }));
    ok('no page or console error', clean(pg), errs(pg));
    await pg.close();
    }

    if (want('options')) {
    console.log('\n── opts.ottava, the classic conversion, and a page without the file ──');
    const po = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    await po.evaluate(() => window.PPP.loadRecordingModules());
    await po.waitForFunction(() => window.PPP.recordingModulesReady() && !!(window.PPPRealizeModules && window.PPPRealizeModules.ottava), { timeout: 30000 });
    const opt = await po.evaluate(h => {
      const A = window.PPPAudioScore, count = r => r.graph.parts.reduce((a, p) => a + p.spanners.filter(s => s.type === 'ottava').length, 0);
      const run = o => A.toMusicXml({ notes: h.notes.map(n => Object.assign({}, n)), title: 'x' }, Object.assign({ title: 'x', closeGaps: true, exactBars: true }, o));
      const r = {};
      r.default = run({ recording: 'v2' }); r.on = run({ recording: 'v2', ottava: 'on' }); r.t = run({ recording: 'v2', ottava: true });
      r.off = run({ recording: 'v2', ottava: 'off' }); r.f = run({ recording: 'v2', ottava: false });
      r.classic = run({}); r.classicOn = run({ ottava: 'on' }); r.classicTrue = run({ ottava: true });
      const out = {}; Object.keys(r).forEach(k => { out[k] = { lines: count(r[k]), xml: (r[k].xml.match(/<octave-shift/g) || []).length, report: !!r[k].ottavaReport, fallback: r[k].ottavaReport ? r[k].ottavaReport.fallback : null }; });
      out.sameXmlOffAndFalse = r.off.xml === r.f.xml; out.sameClassic = r.classic.xml === r.classicOn.xml && r.classic.xml === r.classicTrue.xml; out.sameDefault = r.default.xml === r.on.xml && r.default.xml === r.t.xml;
      out.offKeepsEverythingElse = r.off.xml.replace(/<direction[^>]*>(?:(?!<\/direction>)[\s\S])*octave-shift[\s\S]*?<\/direction>/g, '') === r.off.xml;
      return out;
    }, HEARD);
    ok('v2 by default, with \'on\' and with true: the lines (' + opt.default.lines + ') and <octave-shift> in the MusicXML, the same file each way', opt.default.lines > 0 && opt.default.xml > 0 && opt.default.report && opt.sameDefault, JSON.stringify({ d: opt.default, same: opt.sameDefault }));
    ok('\'off\' and false: no line, no <octave-shift>, no report, the same file', opt.off.lines === 0 && opt.f.lines === 0 && opt.off.xml === 0 && opt.f.xml === 0 && !opt.off.report && !opt.f.report && opt.sameXmlOffAndFalse, JSON.stringify({ o: opt.off, f: opt.f }));
    ok('the classic conversion has none, whatever the option says (same file for no option, \'on\' and true)', opt.classic.lines === 0 && opt.classicOn.lines === 0 && opt.classicTrue.lines === 0 && opt.classic.xml === 0 && !opt.classic.report && opt.sameClassic, JSON.stringify({ c: opt.classic, on: opt.classicOn }));
    await po.close();

    const pn = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' }, failWhile: /\/realize\/ottava\.js/ });
    await addChecker(pn);
    const impN = await importHeard(pn, HEARD);
    const sN = await stateOf(pn);
    const lN = await pn.evaluate(() => ({ lines: (window.PPP.app.state.score.ottavas || []).length, ottava: !!(window.PPPRealizeModules && window.PPPRealizeModules.ottava), ready: window.PPP.recordingModulesReady(), report: window.PPP.app.state.importReport && window.PPP.app.state.importReport.issues.map(i => i.kind) }));
    ok('a page that cannot fetch realize/ottava.js (it is not a stage: v2 is still ready) writes the v2 score without the lines', impN.screen === 'review' && sN.pipeline === 'v2' && lN.ready && !lN.ottava && lN.lines === 0 && sN.notes > 0, JSON.stringify({ imp: impN, p: sN.pipeline, l: lN }));
    ok('and it says nothing is wrong (no "classic method wrote this" line), classes 1-7 are 0, no page error', !(lN.report || []).includes('recording-v2') && Object.values(sN.scoreClasses).every(v => v === 0) && pn.__rec.pageErrors.length === 0, errs(pn));
    await pn.close();
    }

    if (want('classic')) {
    console.log('\n── the classic page: the same heard notes have no lines ──');
    const pc = await openPage(browser);
    await addChecker(pc); await addLedger(pc);
    await importHeard(pc, HEARD);
    const sC = await stateOf(pc), oC = await lines(pc);
    ok('with PPP.recording = legacy the Score and the graph have no octave lines and no head is drawn under one', sC.pipeline === null && oC.scoreLines === 0 && oC.graphLines === 0 && oC.under === 0 && oC.shiftedHeads === 0 && oC.ge3 === oC.ge3Plain, JSON.stringify({ p: sC.pipeline, s: oC.scoreLines, g: oC.graphLines }));
    ok('no page or console error', clean(pc), errs(pc));
    await pc.close();

    console.log('\n── the file is asked for with the stages\' files, once, and by no page that does not use v2 ──');
    const pl = await openPage(browser, { store: { 'ppp.recording.v1': 'v2' } });
    const ottaReq = p => p.__rec.requests.filter(u => /^\/realize\/ottava\.js/.test(u));
    await sleep(2500);
    ok('v2 remembered, no screen that converts is open: not asked for (the arranger\'s own warm-up may bring it, with the same address)', ottaReq(pl).every(u => u === '/realize/ottava.js?v=3'), ottaReq(pl).join(', '));
    await pl.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(250);
    await pl.evaluate(() => document.querySelector('[data-add-card]').click());
    await pl.waitForFunction(() => window.PPP.recordingModulesReady() && !!(window.PPPRealizeModules && window.PPPRealizeModules.ottava), { timeout: 30000 });
    await sleep(500);
    ok('when the Add-sheet-music screen opens it is fetched with the stages (at most twice: the stages\' loader and the arranger\'s, the same address), and it is loaded', ottaReq(pl).length >= 1 && ottaReq(pl).length <= 2 && ottaReq(pl).every(u => u === '/realize/ottava.js?v=3'), ottaReq(pl).join(', '));
    ok('asking again fetches nothing more', await (async () => { const n = ottaReq(pl).length; await pl.evaluate(() => window.PPP.loadRecordingModules()); await sleep(300); return ottaReq(pl).length === n; })());
    ok('no page or console error', clean(pl), errs(pl));
    await pl.close();
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    try { fs.unlinkSync(L.WAV); } catch (e) { /* the temp file */ }
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
