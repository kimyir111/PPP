/* G11a-3: mutation checks of the practice switch (tests/practice/switch.js). One line of the app's page is BROKEN on its way to the browser (the proxy of lib.js rewrites it; no file is
   touched), and the switch test, run on the sections the row names, must go RED. A row that survives is a rule nothing watches; a row whose line is no longer in the page is STALE and
   fails too (a mutation that silently stops applying would pass as a mutant nobody killed). The control (nothing broken) must be green.

     node tests/practice/switch-mutants.js                 every row
     node tests/practice/switch-mutants.js W1 W6           only these rows
     node tests/practice/switch-mutants.js --shard 2/3     every third row, starting at the second (the CI jobs that split the table use this)
     node tests/practice/switch-mutants.js --list
     node tests/practice/switch-mutants.js --url URL       a page already served (the proxy sits in front of it)
   The rows are the ways the call-site wiring, the switch, the fallback and the adapter of the plan could be broken; the first one is the design's own: practicePlan returns the legacy plan under
   'graph'. The places that read `tp.plan || practicePlan(...)` are not mutated: tp.plan is always set where they run, so a mutant there is the same program. */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const L = require('./lib');

const CALL_SITE = (from, to) => [from, to];
const ROWS = [
  /* the wiring */
  ['W1', "practicePlan returns the legacy plan under 'graph'", [["  return practiceGraphPlan(score, from, to);", "  return PianoScore.of(score, from, to);"]], 'leak,spies'],
  ['W2', 'the matcher (begin) asks PianoScore.of again', [["    const plan = practicePlan(score, from, to);", "    const plan = PianoScore.of(score, from, to);"]], 'leak'],
  ['W3', 'the falling notes ask PianoScore.of again', [["  const plan = options.plan || practicePlan(score, from, to);", "  const plan = options.plan || PianoScore.of(score, from, to);"]], 'leak'],
  ['W4', 'beginRun asks PianoScore.of again', [CALL_SITE("    const plan = practicePlan(S.score, from, to);\n    const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n    const startQ = Score.startQ(S.score, from);",
    "    const plan = PianoScore.of(S.score, from, to);\n    const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n    const startQ = Score.startQ(S.score, from);")], 'leak'],
  ['W5', 'startTransport asks PianoScore.of again', [CALL_SITE("    const plan = practicePlan(S.score, from, to);\n    const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n    const t0 = now + this.leadMs(now);",
    "    const plan = PianoScore.of(S.score, from, to);\n    const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n    const t0 = now + this.leadMs(now);")], 'leak,spies'],
  ['W6', 'a transport planned again (hands changed) asks PianoScore.of again', [CALL_SITE("      const plan = practicePlan(S.score, from, to);\n      const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n      if (sq < -0.001",
    "      const plan = PianoScore.of(S.score, from, to);\n      const scale = (S.tempo || 84) / Math.max(1, S.score.tempo || 84);\n      if (sq < -0.001")], 'leak'],
  ['W7', 'the simulation (fire) asks PianoScore.of again', [CALL_SITE("    const plan = practicePlan(S.score, from, to);\n    const list = plan.strikes || [];", "    const plan = PianoScore.of(S.score, from, to);\n    const list = plan.strikes || [];")], 'leak'],
  ['W8', "follow mode's gates are the legacy ones under 'graph'", [["    const viaGraph = !!(gp && gp.graph && practiceModuleReady());", "    const viaGraph = false;"]], 'gates,leak'],
  /* the switch */
  ['W9', "legacy is no longer the default", [["const PRACTICE_DEFAULT = 'legacy';", "const PRACTICE_DEFAULT = 'graph';"]], 'switch'],
  ['W10', 'a value that is neither legacy nor graph is graph', [["function practiceChoice(v) { return v === 'legacy' || v === 'graph' ? v : null; }", "function practiceChoice(v) { return v === 'legacy' ? v : v ? 'graph' : null; }"]], 'switch'],
  ['W11', 'a localStorage that throws gives graph', [["  try { m = practiceChoice(localStorage.getItem(PRACTICE_KEY)) || m; } catch (e) { /* no storage: the default */ }", "  try { m = practiceChoice(localStorage.getItem(PRACTICE_KEY)) || m; } catch (e) { m = 'graph'; }"]], 'switch'],
  ['W12', "a page on 'legacy' asks for practice/plan.js at start", [["if (PRACTICE_MODE === 'graph') loadPracticeModule();", "loadPracticeModule();"]], 'switch'],
  ['W13', "legacy is not PianoScore.of itself (a copy of its plan)", [["  if (PRACTICE_MODE !== 'graph') return PianoScore.of(score, from, to);", "  if (PRACTICE_MODE !== 'graph') return Object.assign({}, PianoScore.of(score, from, to));"]], 'switch'],
  ['W14', 'the setter does not ask for the module', [["  if (c === 'graph') loadPracticeModule();", ""]], 'switch'],
  /* the fallback */
  ['W15', 'a fallback is not counted', [["    practiceCountFallback(score, r.reason);", ""]], 'fallbacks'],
  ['W16', 'a link that is not ok is used', [["  if (!src.link || !src.link.ok) return { reason: 'LINK_FAILED' };", "  if (!src.link) return { reason: 'LINK_FAILED' };"]], 'fallbacks'],
  ['W17', 'a plan that cannot be built is thrown into the player', [["    return { reason: 'BUILD_ERROR' };", "    throw e;"]], 'fallbacks'],
  ['W18', 'a fallback is never decided again', [["  if (hit && (hit.graph || !(hit.tries < 5 && PRACTICE_RETRY[hit.reason] && hit.stamp !== practiceStamp()))) return hit.plan;", "  if (hit) return hit.plan;"]], 'fallbacks'],
  ['W19', 'nothing is kept: every ask builds again', [["  if (hit && (hit.graph || !(hit.tries < 5 && PRACTICE_RETRY[hit.reason] && hit.stamp !== practiceStamp()))) return hit.plan;", "  if (false) return hit.plan;"]], 'fallbacks'],
  ['W28', 'a fallback is decided again at every ask (the stamp is not looked at)', [["hit.tries < 5 && PRACTICE_RETRY[hit.reason] && hit.stamp !== practiceStamp()", "hit.tries < 5 && PRACTICE_RETRY[hit.reason]"]], 'fallbacks'],
  ['W29', 'a fallback is decided again for ever (no limit on the tries)', [["hit.tries < 5 && PRACTICE_RETRY", "PRACTICE_RETRY"]], 'fallbacks'],
  ['W30', 'a plan that cannot be built is decided again whenever the engraver has been busy', [["const PRACTICE_RETRY = { NOT_LOADED: 1, NO_ENGRAVER: 1, RESOLVE_ERROR: 1, NO_GRAPH: 1, LINK_FAILED: 1 };", "const PRACTICE_RETRY = { NOT_LOADED: 1, NO_ENGRAVER: 1, RESOLVE_ERROR: 1, NO_GRAPH: 1, LINK_FAILED: 1, BUILD_ERROR: 1, MEASURES: 1, IDENTITY: 1, EMPTY: 1 };"]], 'fallbacks'],
  ['W20', 'a plan made from the graph is not counted', [["    PRACTICE_STATS.graph++;", ""]], 'switch,fallbacks'],
  /* the plan the player reads */
  ['W21', 'a graph plan is made for the wrong range (the last bar is left out)', [["  const i0 = (Score.measure(score, a) || ms[0]).index, i1 = (Score.measure(score, b) || ms[ms.length - 1]).index;",
    "  const i0 = (Score.measure(score, a) || ms[0]).index, i1 = Math.max(i0, (Score.measure(score, b) || ms[ms.length - 1]).index - 1);"]], 'spies,sweep'],
  ['W22', 'a strike names the graph\'s item, not the Score note', [["      strikes[i].note = n;", ""]], 'visual,sweep'],
  ['W23', 'a tied chain\'s length is not known for the Score note (the falling notes are cut short)', [["    holds.forEach(h => plan.hold.set(h[0], h[1]));", ""]], 'visual,sweep'],
  ['W24', 'the carried-into notes of a tie are not known for the Score note (struck again)', [["    conts.forEach(n => plan.cont.add(n));", ""]], 'sweep'],
  ['W25', 'the matcher\'s expected notes carry no event id', [["        ev: s.ev,", ""]], 'matcher,leak'],
  ['W26', 'the matcher\'s result has no byMeasureIdx', [["      byMeasureIdx: byMeasureIdx,", ""]], 'matcher'],
  ['W27', "the module's plan is built for the Score's tempo of 120, not the Score's", [["  const qpm = +score.tempo > 0 && isFinite(+score.tempo) ? +score.tempo : 84;", "  const qpm = 120;"]], 'spies,sweep']
];

function runSwitch(url, sections) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'switch.js'), '--url', url, '--quick', '--only', sections], { cwd: L.ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({ code, text }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { ROWS.forEach(r => console.log(r[0] + '  ' + r[1] + '  [' + r[3] + ']')); return; }
  let shard = null, url = null;
  const wanted = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shard') { const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || ''); if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error('--shard K/N'); shard = [+m[1], +m[2]]; }
    else if (argv[i] === '--url') url = argv[++i];
    else if (argv[i].startsWith('--')) throw new Error('unknown argument ' + argv[i]);
    else wanted.push(argv[i]);
  }
  let rows = wanted.length ? ROWS.filter(r => wanted.includes(r[0])) : ROWS;
  if (wanted.length && rows.length !== wanted.length) throw new Error('unknown row in ' + wanted.join(' '));
  if (shard) rows = rows.filter((r, i) => i % shard[1] === shard[0] - 1);
  const srv = url ? null : await L.serve();
  const pageUrl = url || srv.url;
  const origin = new URL(pageUrl).origin;
  let problems = 0, killed = 0;
  try {
    /* the control: the proxy in front of the page, nothing broken, must be green on the sections the rows use */
    {
      const t0 = Date.now();
      const proxy = await L.mutatingProxy(origin, []);
      const r = await runSwitch(proxy.url(pageUrl), 'switch,leak,gates');
      await proxy.close();
      const ok = r.code === 0;
      console.log('control (nothing broken): ' + (ok ? 'green' : 'RED, not clean - ' + r.text.split('\n').filter(l => /✗/.test(l)).slice(0, 3).join(' | ')) + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
      if (!ok) problems++;
    }
    for (const [id, what, edits, sections] of rows) {
      const t0 = Date.now();
      const proxy = await L.mutatingProxy(origin, edits);
      let r;
      try { r = await runSwitch(proxy.url(pageUrl), sections); } finally { await proxy.close(); }
      const counts = proxy.counts();
      const stale = !counts || counts.some(c => c !== 1);
      if (stale) { problems++; console.log(id + ' STALE - ' + what + ' - the edit applied ' + JSON.stringify(counts) + ' times'); continue; }
      const first = r.text.split('\n').filter(l => /✗/.test(l))[0];
      if (r.code === 0) { problems++; console.log(id + ' SURVIVED - ' + what + ' - the switch test (' + sections + ') stayed green (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)'); }
      else if (r.code !== 1) { problems++; console.log(id + ' ERROR - ' + what + ' - exit ' + r.code + ': ' + r.text.split('\n').slice(-4).join(' | ')); }
      else { killed++; console.log(id + ' killed - ' + what + ' - ' + (first ? first.trim().slice(0, 150) : 'red') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)'); }
    }
  } finally {
    if (srv) await srv.close();
  }
  console.log('\n' + killed + ' of ' + rows.length + ' mutants killed' + (problems ? ', ' + problems + ' PROBLEM(S)' : ', the control green'));
  process.exit(problems ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
