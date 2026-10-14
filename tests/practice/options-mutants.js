/* G11a-4: mutation checks of the four fixes under PPP.practice 'graph' (tests/practice/options.js). One line of the app's page is BROKEN on its way to the browser (the proxy of lib.js rewrites it;
   no file is touched), and the options test, run on the sections the row names, must go RED. A row that survives is a rule nothing watches; a row whose line is no longer in the page is STALE and
   fails too. The control (nothing broken) must be green.

     node tests/practice/options-mutants.js                 every row
     node tests/practice/options-mutants.js O1 O6           only these rows
     node tests/practice/options-mutants.js --shard 2/3     every third row, starting at the second (the CI jobs that split the table use this)
     node tests/practice/options-mutants.js --list
     node tests/practice/options-mutants.js --url URL       a page already served (the proxy sits in front of it)

   The rows are the ways the four fixes could be broken: a fix that is not on, a fix that is on for the wrong thing, a grace that is judged, a visit that is counted wrong, an option that is not
   seen by a cache. The plan's own rules (the tie at a jump, the order of a D.S.) are practice/plan.js and its mutants (tests/practice/mutation.test.js, parity-mutants.js). */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const L = require('./lib');

const FIX = "jumps: PRACTICE_FIX.indexOf('jumps') >= 0 ? 'once' : false, graces: PRACTICE_FIX.indexOf('graces') >= 0 ? 'play' : false });";
const ROWS = [
  /* the four fixes are on, and each is one thing */
  ['O1', 'the jumps are not followed (D.C./D.S./Fine/To Coda are not played)', [[FIX, "jumps: false, graces: PRACTICE_FIX.indexOf('graces') >= 0 ? 'play' : false });"]], 'plans,laps,fixture,sweep'],
  ['O2', 'the grace notes do not sound', [[FIX, "jumps: PRACTICE_FIX.indexOf('jumps') >= 0 ? 'once' : false, graces: false });"]], 'plans,spies,visual,sweep'],
  ['O3', 'the grace notes are judged (the matcher asks them)', [["(graced ? plan.strikes.filter(s => !s.grace) : (plan.strikes || []))", "(plan.strikes || [])"]], 'plans,matcher,fixture,sweep'],
  ['O4', 'a grace note that is played is a wrong note', [["        if (this.graces[i].midi === ev.midi && Math.abs(ev.t - this.graces[i].tMs) <= w) return { verdict: 'grace', midi: ev.midi };", "        if (false) return { verdict: 'grace', midi: ev.midi };"]], 'matcher'],
  ['O5', 'follow mode asks a repeated bar once (the repeats are not asked each time)', [["{ repeats: PRACTICE_FIX.indexOf('repeats') >= 0, ties:", "{ repeats: false, ties:"]], 'gates,fixture,sweep,small'],
  ['O6', 'follow mode skips a tie that leads nowhere (the notes the clock strikes are not all asked)', [["ties: PRACTICE_FIX.indexOf('ties') >= 0 });", "ties: false });"]], 'gates,fixture,sweep'],
  ['O7', 'an expected note names the bar as its visit', [["map(s => (s.visit ? at.get(s.visit) : -1))", "map(s => (s.visit ? s.visit.index : -1))"]], 'matcher'],
  ['O8', 'a grace note is looked up as a Score note (every piece with graces falls back to the legacy plan)', [["      if (strikes[i].grace) continue;", ""]], 'plans,sweep'],
  ['O9', 'the simulation (no keyboard) judges a grace note', [["      if (s.grace || !this.handOk(s.note, this.playHands(S))) continue;", "      if (!this.handOk(s.note, this.playHands(S))) continue;"]], 'small'],
  ['O10', 'the plan is kept without the option that made it', [["  const key = a + ':' + b + ':' + PRACTICE_FIX.join(',');", "  const key = a + ':' + b;"]], 'small'],
  ['O11', "follow mode's gates are kept without the option that made them", [["(viaGraph ? ':graph:' + PRACTICE_FIX.join(',') : '')", "(viaGraph ? ':graph' : '')"]], 'small'],
  ['O12', 'the fixes are off unless asked', [["  let f = PRACTICE_FIX_NAMES.slice();\n  try { f = practiceFixChoice(localStorage.getItem(PRACTICE_FIX_KEY)) || f; }", "  let f = [];\n  try { f = practiceFixChoice(localStorage.getItem(PRACTICE_FIX_KEY)) || f; }"]], 'choice,plans'],
  ['O13', 'a list with a name that is none is a choice of the names that are', [["parts.every(p => PRACTICE_FIX_NAMES.indexOf(p) >= 0)", "parts.some(p => PRACTICE_FIX_NAMES.indexOf(p) >= 0)"]], 'choice'],
  ['O14', 'a value that is no choice does not forget the remembered one', [["else localStorage.removeItem(PRACTICE_FIX_KEY); } catch (e) { /* not remembered */ }\n  return practiceFixText(PRACTICE_FIX);", "else { /* kept */ } } catch (e) { /* not remembered */ }\n  return practiceFixText(PRACTICE_FIX);"]], 'choice'],
  ['O15', 'the keyboard hint skips every tied-to note (a tie that leads nowhere is not shown)', [["    return n => n.tieStop && cont.has(n);", "    return n => n.tieStop;"]], 'small'],
  ['O16', 'a grace note is not marked on the falling notes', [["    if (strike.grace) notes[notes.length - 1].grace = true;", ""]], 'visual'],
  ['O17', 'the falling notes draw a note the length of its whole tie chain (a tie cut at a jump is not drawn cut)', [["const heldQ = strike.heldQ != null ? Math.max(0.05, strike.heldQ) : Math.max(0.05, PianoScore.hold(plan, source));", "const heldQ = Math.max(0.05, PianoScore.hold(plan, source));"]], 'fixture,visual'],
  ['O18', 'a plan that followed a jump is not counted', [["    if (r.plan.jumps && r.plan.jumps.length) PRACTICE_STATS.jumps++;", ""]], 'plans'],
  ['O19', 'the simulation reads the plan of the moment, not the run\'s own', [["const plan = (PRACTICE_MODE === 'graph' && this._tp && this._tp.plan) || practicePlan(S.score, from, to);\n    const list = plan.strikes || [];", "const plan = practicePlan(S.score, from, to);\n    const list = plan.strikes || [];"]], 'small'],
  ['O21', 'a pause is resumed in the first visit of its bar (the transport and the falling notes forget where the run was)', [["if (PRACTICE_MODE === 'graph' && r && r.plan === plan && Math.abs(PianoScore.writtenAtSound(plan, r.sq) - b) < 1e-6) return r.sq;", "if (false) return r.sq;"]], 'small'],
  ['O22', 'the matcher begins at the first visit of the bar the transport resumed in (every expected note is a stretch away)', [["< 1e-6 ? tp.b0 : sq0;", "< 1e-6 ? sq0 : sq0;"]], 'small'],
  ['O23', 'a seek after a pause is resumed at the place of the pause (the next Play ignores where the person put the playhead)', [["Math.abs(PianoScore.writtenAtSound(plan, r.sq) - b) < 1e-6) return r.sq;", "true) return r.sq;"]], 'small'],
  ['O24', 'follow mode counts a key pressed for a grace note of the onset as a wrong note', [["    if (want.indexOf(ev.midi) < 0 && g.graces && g.graces.indexOf(ev.midi) >= 0) return;", ""]], 'followgrace'],
  ['O25', 'follow mode counts a key pressed for a grace note of the onset after a rest as a wrong note', [["(g.graces && g.graces.indexOf(ev.midi) >= 0) || (ng && ng.graces && ng.graces.indexOf(ev.midi) >= 0 && wantOf(ng).indexOf(ev.midi) < 0)", "false"]], 'followgrace'],
  ['O26', 'a grace is drawn as wide as its key', [["  if (note.grace) { const w = Math.max(2, rect.width * 0.5); rect.x += (rect.width - w) / 2; rect.width = w; }", ""]], 'visual'],
  ['O27', 'the grace window of the matcher is a second wide: a wrong key long after a grace is forgiven', [["Math.abs(ev.t - this.graces[i].tMs) <= w) return { verdict: 'grace'", "Math.abs(ev.t - this.graces[i].tMs) <= w * 4) return { verdict: 'grace'"]], 'matcher'],
  ['O20', 'the setter does not read the list (anything is "on")', [["  if (typeof v !== 'string' || !v) return null;\n  const parts = v.split(',');", "  if (typeof v !== 'string' || !v) return null;\n  return PRACTICE_FIX_NAMES.slice();\n  const parts = v.split(',');"]], 'choice']
];

function runOptions(url, sections) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'options.js'), '--url', url, '--quick', '--only', sections], { cwd: L.ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    {
      const t0 = Date.now();
      const proxy = await L.mutatingProxy(origin, []);
      const r = await runOptions(proxy.url(pageUrl), 'choice,plans,matcher,gates,small');
      await proxy.close();
      console.log('control (nothing broken): ' + (r.code === 0 ? 'green' : 'RED, not clean - ' + r.text.split('\n').filter(l => /✗/.test(l)).slice(0, 3).join(' | ')) + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
      if (r.code !== 0) problems++;
    }
    for (const [id, what, edits, sections] of rows) {
      const t0 = Date.now();
      const proxy = await L.mutatingProxy(origin, edits);
      let r;
      try { r = await runOptions(proxy.url(pageUrl), sections); } finally { await proxy.close(); }
      const counts = proxy.counts();
      const stale = !counts || counts.some(c => c !== 1);
      if (stale) { problems++; console.log(id + ' STALE - ' + what + ' - the edit applied ' + JSON.stringify(counts) + ' times'); continue; }
      const first = r.text.split('\n').filter(l => /✗/.test(l))[0];
      if (r.code === 0) { problems++; console.log(id + ' SURVIVED - ' + what + ' - the options test (' + sections + ') stayed green (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)'); }
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
