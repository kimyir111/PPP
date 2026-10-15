/* G11c-1: mutation checks of PPP.variant (the Loop panel's "Make this passage easier"), in the page. One rule of the page is BROKEN on its way to the browser
   (tests/practice/learner-proxy.js rewrites lines of the served file; no file is touched) and the sections of tests/variant-app.test.js that watch that rule must go red.
   A mutant that survives is a rule nothing watches; a row whose line is no longer in the file is STALE and fails too. The control (nothing mutated) must be green.
   The rules of practice/variant.js itself (a tie kept across a seam, identical bars accepted, an off-by-one range, ...) are broken by tests/practice-variant/variant-mutation.test.js.

     node tests/practice/variant-mutants.js               the control, then every row (about 25 minutes)
     node tests/practice/variant-mutants.js V3 V6         only these rows (and the control unless --no-control)
     node tests/practice/variant-mutants.js --list
     node tests/practice/variant-mutants.js --shard 2/3   every third row from the second (the CI job runs three shards)
     node tests/practice/variant-mutants.js --upstream http://127.0.0.1:9210     use that server of this tree (default: one on a free port)

   Needs puppeteer. LL_PORT_RANGE="9220-9249" keeps the proxy's port in a range (the same variable as the learner mutants). */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { fileProxy } = require('./learner-proxy');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = 'Piano Coach App.dc.html';
const WITH_PORT = path.join(ROOT, 'tests', 'engrave', 'tools', 'with-port.js');

/* id, what the mutant breaks, [{file, from, to}] (each `from` is in its file exactly once), and the sections of tests/variant-app.test.js that must notice */
const ROWS = [
  ['V1', 'the splice is asked for one bar too many (the last bar of the passage + 1)', [{ file: APP, from: "from: r.from, to: r.to, direction: 'easier', weights: reference.weights,", to: "from: r.from, to: r.to + 1, direction: 'easier', weights: reference.weights," }], ['flow']],
  ['V2', 'the splice is asked for one bar too early (the first bar - 1)', [{ file: APP, from: "from: r.from, to: r.to, direction: 'easier', weights: reference.weights,", to: "from: Math.max(0, r.from - 1), to: r.to, direction: 'easier', weights: reference.weights," }], ['flow']],
  ['V3', 'the original\'s own Score is changed by the copy (its title becomes the copy\'s; the open original is written back that way when it is put away)', [{ file: APP, from: 'arranged.source = source;\n      const buildTag = typeof window', to: 'arranged.source = source;\n      S.score.title = arranged.title;\n      const buildTag = typeof window' }], ['flow']],
  ['V4', 'the copy is swapped in place of the original (the copy\'s id is the original\'s)', [{ file: APP, from: "return 'song-v' + (Z && Z.fnv1a64 ? Z.fnv1a64(Z.utf8(text)) : String(text.length)).slice(0, 14);", to: 'return parentId;' }], ['flow', 'determ']],
  ['V5', 'a refusal is ignored: the original\'s own bars are shown as the easier version', [
    { file: APP, from: 'const res = V.splice(graph, sn.graph, {', to: 'let res = V.splice(graph, sn.graph, {' },
    { file: APP, from: "if (!res.ok) return refuse(res.reason, { hands: res.alternative ? res.alternative.hands : 'both', why: res.detail });", to: "if (!res.ok) res = { ok: true, graph: graph, final: { from: r.from, to: r.to }, widened: { left: 0, right: 0 }, judge: null };" }], ['refusal']],
  ['V6', 'the YouTube mark is not copied to the variant (only the parent chain is left)', [{ file: APP, from: 'if (this.youtubeDerivedOf(d.parentId)) source.youtubeDerived = true;', to: '' }], ['sharing']],
  ['V7', 'the default is on', [{ file: APP, from: "const VARIANT_DEFAULT = 'off';", to: "const VARIANT_DEFAULT = 'on';" }], ['switch']],
  ['V8', 'the button and its row show while the switch is off', [
    { file: APP, from: "showVariantRow: tab === 'loop' && (on || !!copyOf),", to: "showVariantRow: tab === 'loop'," },
    { file: APP, from: "showVariantOpen: tab === 'loop' && on,", to: "showVariantOpen: tab === 'loop'," }], ['switch']],
  ['V9', 'the panel opens (and asks for its files) while the switch is off', [{ file: APP, from: "openVariantPanel() {\n    if (VARIANT_MODE !== 'on') return;\n", to: 'openVariantPanel() {\n' }], ['switch']],
  ['V10', 'the copy takes the original\'s progress (its history and memory) instead of its own', [{ file: APP, from: 'score: packScore(arranged), secs: seedSecs(arranged), history: Learning.empty(), memory: Memory.empty(),\n        loopFrom: Score.snap(arranged, d.fromNo)', to: 'score: packScore(arranged), secs: seedSecs(arranged), history: S.history, memory: S.memory,\n        loopFrom: Score.snap(arranged, d.fromNo)' }], ['flow']],
  ['V11', 'the way back opens the original on its first bars, not the passage', [{ file: APP, from: 'const a = sc.measures[i0].number;\n      return { screen: \'player\', loop: true, practiceMode: \'practice\', loopFrom: a, loopTo: sc.measures[i1].number,', to: 'const a = sc.measures[0].number;\n      return { screen: \'player\', loop: true, practiceMode: \'practice\', loopFrom: a, loopTo: sc.measures[0].number,' }], ['flow']],
  ['V12', 'the copy opens on its first bars, not the passage', [{ file: APP, from: 'const sc = st.score, a = Score.snap(sc, fromNo), b = Math.max(a, Score.snap(sc, toNo));', to: 'const sc = st.score, a = Score.snap(sc, 1), b = Math.max(a, Score.snap(sc, 2));' }], ['flow']],
  ['V13', 'the hand the person chose is ignored when the copy opens', [{ file: APP, from: "hands: hands === 'right' || hands === 'left' ? hands : 'both',", to: "hands: 'both'," }], ['flow']],
  ['V14', 'asking again for the same bars makes a second preview instead of saying the copy is there', [{ file: APP, from: "if (this.libraryRead().songs.some(s => s.id === id)) return patch({ phase: 'exists', copyId: id });", to: '' }], ['determ']],
  ['V15', 'a refusal offers no alternative', [{ file: APP, from: "if (reason !== 'NOT_LOADED' && reason !== 'FAILED') {", to: 'if (false) {' }], ['refusal']],
  ['V16', 'the alternative tempo is not 70 % of the score\'s', [{ file: APP, from: "alts.push({ id: 'tempo', label: tempoOf('both'), on: () => this.applyVariantAlternative({ tempoPct: pct, hands: 'both', label: tempoOf('both') }) });", to: "alts.push({ id: 'tempo', label: tempoOf('both'), on: () => this.applyVariantAlternative({ tempoPct: 100, hands: 'both', label: tempoOf('both') }) });" }], ['refusal']],
  ['V17', 'the copy\'s id depends on the clock (the same request is a new song every time)', [{ file: APP, from: "const text = ['ppp.g11c1', parentId, hash, from, to, levelChoice === 'easiest' ? 'easiest' : 'one'].join('|');", to: "const text = ['ppp.g11c1', parentId, hash, from, to, levelChoice === 'easiest' ? 'easiest' : 'one', Date.now()].join('|');" }], ['determ']],
  ['V18', 'there is no busy state (the panel stays on its choices until the answer)', [{ file: APP, from: "patch({ phase: 'busy', fromNo: r.fromNo, toNo: r.toNo, refusal: null, stats: null, long: (score.notes || []).length > 600 });", to: 'patch({ fromNo: r.fromNo, toNo: r.toNo, refusal: null, stats: null });' }], ['busy']],
  ['V19', '"as easy as possible" is the same as one step easier', [{ file: APP, from: "const levelChoice = ui.level === 'easiest' && ui.stage >= 3 ? 'easiest' : 'one';", to: "const levelChoice = 'one';" }], ['levels']],
  ['V20', 'the preview says the tune stays whatever happened to it', [{ file: APP, from: 'if (st.tuneKept) lines.push(tx(\'The tune stays as written.\'));', to: 'lines.push(tx(\'The tune stays as written.\'));' }], ['levels']],
  ['V21', 'the copy is saved without the original\'s bars one for one: its source is not marked as made from the original', [{ file: APP, from: "provider: 'PPP easier passage', createdAt: Clock.now(),", to: "provider: 'PPP easier passage', createdAt: Clock.now(), parentSongId: undefined," }], ['flow']]
];

function runSuite(port, sections, upstreamEnv) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { PPP_PORT: String(port), NODE_ENV: 'production' }, upstreamEnv || {});
    delete env.PPP_URL;
    if (sections) env.VA_ONLY = sections.join(','); else delete env.VA_ONLY;
    const child = spawn(process.execPath, ['-r', WITH_PORT, path.join(ROOT, 'tests', 'variant-app.test.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({ code, text }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { ROWS.forEach(r => console.log(r[0] + '  ' + r[1] + '  [' + r[3].join(',') + ']')); return; }
  const ui = argv.indexOf('--upstream');
  const si = argv.indexOf('--shard');
  const shard = si >= 0 ? /^(\d+)\/(\d+)$/.exec(argv[si + 1] || '') : null;
  if (si >= 0 && (!shard || +shard[1] < 1 || +shard[1] > +shard[2])) throw new Error('--shard K/N');
  const wanted = argv.filter((a, i) => !a.startsWith('--') && !(ui >= 0 && i === ui + 1) && !(si >= 0 && i === si + 1));
  let rows = wanted.length ? ROWS.filter(r => wanted.includes(r[0])) : ROWS;
  if (wanted.length && rows.length !== wanted.length) throw new Error('unknown row in ' + wanted.join(' '));
  if (shard) rows = rows.filter((r, i) => i % +shard[2] === +shard[1] - 1);
  let upstream = ui >= 0 ? argv[ui + 1] : null, closeUp = async () => {};
  if (!upstream) {
    const { startServer } = require('../serve-free');
    const srv = await startServer();
    upstream = new URL(srv.url).origin;
    closeUp = srv.close;
  }
  let bad = 0;
  const report = [];
  try {
    if (!argv.includes('--no-control')) {
      const t0 = Date.now();
      const p = await fileProxy(upstream, {});
      const r = await runSuite(p.port, null);
      await p.close();
      const clean = r.code === 0;
      console.log('control (nothing mutated): ' + (clean ? 'green' : 'NOT GREEN (exit ' + r.code + ')') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
      if (!clean) { bad++; console.log(r.text.split('\n').filter(l => /✗|Error/.test(l)).slice(0, 10).join('\n')); }
    }
    for (const [id, what, edits, sections] of rows) {
      const t1 = Date.now();
      const p = await fileProxy(upstream, { edits });
      const r = await runSuite(p.port, sections);
      const counts = p.counts();
      await p.close();
      if (counts.some(c => c !== 1)) { report.push([id, 'STALE']); bad++; console.log(id + ' STALE: applied ' + JSON.stringify(counts) + ' times - ' + what); continue; }
      const killed = r.code !== 0;
      const failed = r.text.split('\n').filter(l => /^\s*✗/.test(l)).length;
      if (!killed) bad++;
      report.push([id, killed ? 'killed' : 'SURVIVED']);
      console.log(id + ' ' + (killed ? 'killed' : 'SURVIVED') + ' - ' + what + ' - ' + (killed ? failed + ' check(s) red in ' + sections.join('+') : 'sections ' + sections.join('+') + ' stayed green') + ' (' + ((Date.now() - t1) / 1000).toFixed(0) + ' s)');
    }
  } finally {
    await closeUp();
  }
  const killed = report.filter(r => r[1] === 'killed').length;
  console.log('\n' + killed + ' of ' + rows.length + ' mutants killed' + (bad ? ', ' + bad + ' PROBLEM(S)' : ', the control green'));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
