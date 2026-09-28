/* ============================================================================
   DIFFICULTY (G06 §11 G6b)

   PPP.difficulty = 'legacy' (default) | 'g6': the Analysis screen's "Difficulty"
   fact and hard-parts list, and the Coach's structural context, either keep
   reading Score.deriveSections / Coach.structural exactly as they did before
   G6b, or read G6a's committed ranker (difficulty/index.js, weights in
   difficulty/weights/g6a-v1.json) over the SAME ScoreGraph the renderer
   already resolves for the open Score (PPPEngrave.app.resolveSync).

   What this checks:
     - the switch defaults to 'legacy', and an unrecognized value falls back
       to it (App.PPP.difficulty, App:~9298)
     - OFF: a freshly imported piece (no play history yet, so the "from the
       notation" branch runs, not the "from your playing" one) gets exactly
       the facts/hard-list/coach-structural text the app produced before G6b -
       checked against the legacy formula recomputed independently here, not
       just "the app didn't crash"
     - ON: the same piece's Analysis facts and Coach context read G6's level,
       hotspots and reasons instead
     - the honest degraded case: Beyer No. 1, a real corpus piece G6a's own
       report (G06 §11) documents as a one-staff duet part with no hand on any
       note by default (`handFallback`) - assess() must still return a level,
       not throw or show an error
     - performance of App.difficultyAssessment() in the browser, at song-load
       time, on sonatina/020 (the longest corpus piece, per G6a's own report)
   ========================================================================== */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const b64 = file => fs.readFileSync(file).toString('base64');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await preparePage(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('\n── PPP.difficulty switch (G6b): legacy default, g6 opt-in ──');
  const sw = await page.evaluate(() => {
    const saved = window.PPP.difficulty;
    window.PPP.difficulty = 'some-typo';
    const typo = window.PPP.difficulty;
    window.PPP.difficulty = saved;
    return { defaultMode: saved, typoMode: typo };
  });
  ok('PPP.difficulty defaults to \'legacy\'', sw.defaultMode === 'legacy', sw.defaultMode);
  ok('an unrecognized value falls back to \'legacy\' (G4-F2-1\'s convention)', sw.typoMode === 'legacy', sw.typoMode);

  console.log('\n── the difficulty modules load, and the graph pipeline the renderer already uses is what G6 reads ──');
  const modules = await page.evaluate(() => ({
    difficulty: !!window.PPPDifficulty,
    playability: !!window.PPPPlayability,
    engrave: !!(window.PPPEngrave && window.PPPEngrave.app && typeof window.PPPEngrave.app.resolveSync === 'function')
  }));
  ok('difficulty/index.js is loaded (root.PPPDifficulty)', modules.difficulty);
  ok('playability/index.js is loaded (root.PPPPlayability, difficulty/features.js\' own dependency)', modules.playability);
  ok('PPPEngrave.app.resolveSync is the graph source G6 reuses (G02\'s import boundary, confirmed the way G5c did for fingering)', modules.engrave);

  console.log('\n── a freshly imported piece, switch OFF: byte-identical to before G6b ──');
  const beyer1 = b64(path.join(__dirname, '..', 'catalog', 'method', 'beyer', '001.mxl'));
  const off = await page.evaluate(async b64xml => {
    window.PPP.difficulty = 'legacy';
    const A = window.PPP.app;
    const bin = atob(b64xml);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const xml = await window.PPP.readMxl(bytes.buffer);
    const sc = window.PPP.scoreFromXml(xml, 'beyer-001-off.musicxml');
    A.adoptScore(sc);
    const learn = A.model();
    const secs = sc.sections || [];
    const legacyAvg = secs.reduce((a, s) => a + (s.score || 0), 0) / Math.max(1, secs.length);
    const legacyLabel = window.PPP.tx(legacyAvg > 26 ? 'Advanced' : legacyAvg > 14 ? 'Intermediate' : 'Beginner');
    const legacyHard = secs.filter(s => s.hard);
    const legacyHardCount = window.PPP.tx('From the notation, PPP expects {{n}} tricky sections.', { n: legacyHard.length });
    const legacyHardList = legacyHard.map(s => ({
      range: window.PPP.tx('Measures {{from}}–{{to}}', { from: s.from, to: s.to }),
      reason: window.PPP.tx(s.reason)
    }));
    const rv = A.renderVals();
    const factRow = rv.facts.find(f => f.k === window.PPP.tx('Difficulty'));
    const st = window.PPP.Coach.structural(sc);
    return {
      scoreId: sc.id,
      learnRangesLen: learn.ranges.length,
      da: A.difficultyAssessment(),
      label: factRow ? factRow.v : null, legacyLabel,
      hardCount: rv.hardCount, legacyHardCount,
      hard: rv.hard.map(h => ({ range: h.range, reason: h.reason })), legacyHardList,
      coachStructuralText: rv.coachStructural,
      structuralSame: JSON.stringify(A.coachContext().structural) === JSON.stringify(st)
    };
  }, beyer1);
  ok('a freshly imported piece starts with no learning-based ranges (the notation branch is what runs)', off.learnRangesLen === 0, String(off.learnRangesLen));
  ok('difficultyAssessment() returns null under \'legacy\' (default)', off.da === null, JSON.stringify(off.da));
  ok('the Difficulty fact is exactly the legacy avg-section label', off.label === off.legacyLabel, off.label + ' vs ' + off.legacyLabel);
  ok('hardCount text matches the legacy count exactly', off.hardCount === off.legacyHardCount, off.hardCount + ' vs ' + off.legacyHardCount);
  ok('the hard list matches deriveSections\' own hard flags, range and reason, exactly', JSON.stringify(off.hard) === JSON.stringify(off.legacyHardList),
    JSON.stringify(off.hard) + ' vs ' + JSON.stringify(off.legacyHardList));
  ok('Coach.context()\'s structural field is byte-identical to Coach.structural(score) directly', off.structuralSame);

  console.log('\n── another fresh piece, switch ON: G6\'s level, hotspots and reasons replace the legacy ones ──');
  /* Beyer No. 65 (not No. 1: the corpus' easiest, almost-empty first duet part used above never rises
     above its own average anywhere, so it has no hotspot at all - a legitimate result checked separately
     below, not what this section is testing) has both a real level move (it is where G6a's own report
     places the Beyer/Czerny 100 boundary) and real per-measure hotspots. */
  const beyer65 = b64(path.join(__dirname, '..', 'catalog', 'method', 'beyer', '065.mxl'));
  const on = await page.evaluate(async b64xml => {
    window.PPP.difficulty = 'g6';
    const A = window.PPP.app;
    const bin = atob(b64xml);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const xml = await window.PPP.readMxl(bytes.buffer);
    const sc = window.PPP.scoreFromXml(xml, 'beyer-065-on.musicxml');
    A.adoptScore(sc);
    let da = null;
    for (let i = 0; i < 60 && !da; i++) { da = A.difficultyAssessment(); if (!da) await new Promise(r => setTimeout(r, 50)); }
    const rv = A.renderVals();
    const factRow = rv.facts.find(f => f.k === window.PPP.tx('Difficulty'));
    const ctx = A.coachContext();
    return {
      loaded: !!da, level: da && da.level, reasons: da && da.reasons,
      hotspots: da && da.hotspots,
      label: factRow ? factRow.v : null,
      hardCount: rv.hardCount,
      hard: rv.hard,
      coachStructuralText: rv.coachStructural,
      structural: ctx.structural
    };
  }, beyer65);
  ok('the g6a-v1.json weights load and difficultyAssessment() resolves within 3s', on.loaded);
  ok('a level anchored to a named method-book point is returned', !!(on.level && on.level.book && on.level.stageName), JSON.stringify(on.level));
  ok('at least one human-readable reason is returned', !!(on.reasons && on.reasons.length && on.reasons[0].text), JSON.stringify(on.reasons));
  ok('a per-measure hotspot map is returned', !!(on.hotspots && on.hotspots.length), on.hotspots ? on.hotspots.length + ' hotspots' : 'none');
  ok('the Difficulty fact is G6\'s level, not the legacy Beginner/Intermediate/Advanced label', !/^(Beginner|Intermediate|Advanced)$/.test(on.label), on.label);
  ok('the Difficulty fact names a method-book point (the "No." convention)', /No\.\s*\d+/.test(on.label) || /beyond/.test(on.label), on.label);
  ok('the hard list is now G6\'s hotspots, one measure each', on.hard.length === Math.min(on.hotspots.length, on.hard.length) && on.hard.every(h => /^Measure \d/.test(h.range)),
    JSON.stringify(on.hard.slice(0, 2)));
  ok('the Coach panel\'s structural line names a single measure, G6\'s own top hotspot', /measure \d+ looks hardest/.test(on.coachStructuralText), on.coachStructuralText);
  ok('the Coach context\'s structural field carries G6\'s level, not the legacy sections/traits shape', !!(on.structural && on.structural.level), JSON.stringify(on.structural && on.structural.level));
  ok('the Coach context is honest about what G6 does and does not know (G6a §11, decision G6-L1)',
    /book it has (trained on|never seen)/.test(on.structural.note || ''), on.structural.note);

  console.log('\n── switching back OFF restores the legacy view for the same score ──');
  const backOff = await page.evaluate(() => {
    window.PPP.difficulty = 'legacy';
    const A = window.PPP.app;
    return { da: A.difficultyAssessment(), label: A.difficultyLabel() };
  });
  ok('difficultyAssessment() is null again once the switch is off, for the very same score object', backOff.da === null, JSON.stringify(backOff.da));
  ok('and the label reverts to the legacy Beginner/Intermediate/Advanced text', /^(Beginner|Intermediate|Advanced)$/.test(backOff.label), backOff.label);

  console.log('\n── the honest degraded case: Beyer No. 1, a one-staff duet part with no hand on any note by default ──');
  const handFallback = await page.evaluate(async b64xml => {
    window.PPP.difficulty = 'g6';
    const A = window.PPP.app;
    const bin = atob(b64xml);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const xml = await window.PPP.readMxl(bytes.buffer);
    const sc = window.PPP.scoreFromXml(xml, 'beyer-001-g6.musicxml');
    A.adoptScore(sc);
    let da = null;
    for (let i = 0; i < 60 && !da; i++) { da = A.difficultyAssessment(); if (!da) await new Promise(r => setTimeout(r, 50)); }
    const src = window.PPPEngrave.app.resolveSync(sc);
    const feats = window.PPPDifficulty.features.featuresOf(src.graph);
    return {
      handFallback: feats.handFallback, scoreFinite: da && Number.isFinite(da.score),
      level: da && da.level, label: A.difficultyLabel(), threw: false
    };
  }, beyer1).catch(e => ({ threw: true, message: e.message }));
  ok('features.js reports the documented one-staff handFallback for this exact piece (G6a §11 point 6)', handFallback.handFallback === true, JSON.stringify(handFallback));
  ok('assess() still returns a finite score and a level - no throw, no error view', !handFallback.threw && handFallback.scoreFinite === true && !!handFallback.level, JSON.stringify(handFallback));
  ok('the Analysis screen still shows a sensible label for it, not blank or "undefined"', typeof handFallback.label === 'string' && handFallback.label.length > 0 && handFallback.label !== 'undefined', handFallback.label);

  console.log('\n── performance in the browser (G06 §7), sonatina/020 (the longest corpus piece) ──');
  const sonatina = b64(path.join(__dirname, '..', 'catalog', 'method', 'sonatina', '020.mxl'));
  const perf = await page.evaluate(async b64xml => {
    window.PPP.difficulty = 'g6';
    const A = window.PPP.app;
    const bin = atob(b64xml);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const xml = await window.PPP.readMxl(bytes.buffer);
    /* warm up parsing/JIT on a throwaway import before timing either call */
    A.adoptScore(window.PPP.scoreFromXml(xml, 'perf-warm.mxl'));
    let warm = A.difficultyAssessment();
    for (let i = 0; i < 60 && !warm; i++) { warm = A.difficultyAssessment(); if (!warm) await new Promise(r => setTimeout(r, 50)); }

    const sc = window.PPP.scoreFromXml(xml, 'perf-cold.mxl');
    const t0 = performance.now();
    A.adoptScore(sc);
    const cold = A.difficultyAssessment();
    const coldMs = performance.now() - t0;

    const t1 = performance.now();
    const cached = A.difficultyAssessment();
    const cachedMs = performance.now() - t1;
    return { coldMs, cachedMs, coldOk: !!cold, cachedIsSameObject: cached === cold, notes: sc.notes.filter(n => !n.rest).length };
  }, sonatina);
  ok('sonatina/020 gets a G6 assessment on first view (cold: graph resolution + features + inference)', perf.coldOk, perf.notes + ' notes');
  ok('cold difficultyAssessment() stays under a 200ms single-song budget (browser, once per song load, not per render)',
    perf.coldMs < 200, perf.coldMs.toFixed(1) + 'ms');
  ok('a second call for the same score is served from the cache (App.difficultyAssessment\'s own _da, fingerPlan()\'s pattern) - effectively free',
    perf.cachedMs < 2 && perf.cachedIsSameObject, perf.cachedMs.toFixed(2) + 'ms, same object: ' + perf.cachedIsSameObject);

  console.log('\n── nothing broke ──');
  ok('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');

  await browser.close();
  console.log('\n──────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('PPP.difficulty ships off by default, byte-identical to before G6b, and surfaces G6\'s level/hotspots/reasons when switched on.');
})().catch(e => { console.error(e); process.exit(1); });
