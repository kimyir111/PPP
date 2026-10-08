/* G11a-2: does the parity check notice a plan that got worse? (docs/GOALS/G11 section 6.2, item 8: "mutation tests on practice/plan.js ... must each fail the check")

   practice/plan.js is mutated here the way tests/practice/mutation.test.js mutates it (a copy of the module with ONE line changed; each anchor must match exactly once,
   so a row whose line has moved is STALE and fails rather than passing as a mutant nobody killed), but the copy is not probed on one fixture: it is added to the running
   page in place of the real one (addScriptTag) and the whole parity check runs on it - the same corpus sample, the same scripted performances, the same scheduler spies. A mutant is KILLED when
   the check goes red (a difference from the legacy player, an unexplained difference, a scheduler spy that differs, or a change of the baseline's counts per file).

     node tests/practice/parity-mutants.js              the five rows the design names (CORE) + the rows below, on a sample of the corpus
     node tests/practice/parity-mutants.js --core       only the five
     node tests/practice/parity-mutants.js M1 M2        only these rows
     node tests/practice/parity-mutants.js --shard 2/4  every fourth of the selected rows, starting at the second (the CI matrix)
     node tests/practice/parity-mutants.js --list
     node tests/practice/parity-mutants.js --sample 3   a bigger sample (default 8: every 8th catalogue file, every fixture, every file the baseline gives a cause)

   Exit code 0 when the unmutated control is clean and every CORE row is killed and every other row is either killed or marked as watched elsewhere (WATCHED_BY_UNIT: a rule of
   the graph, or a detail of a fix, that the cause table does not look into and tests/practice/plan.test.js does; the reason is in the row).  */
'use strict';
const fs = require('fs');
const P = require('./parity');

/* id, core?, what the mutant breaks, [[find, replace], ...] (find is exactly one place of plan.js), watched elsewhere (a reason) or '' */
const ROWS = [
  /* the five the design names */
  ['PM1', true, 'a printed pedal change no longer lifts the damper (CC64 0 then 127 becomes 127 only)', [["const lifts = p => !!p && p.type === 'change'", "const lifts = p => !!p && p.type === 'never'"]], ''],
  ['PM2', true, 'one visit is placed half a quarter late (every strike after it drifts from the written bars)', [['soundLengthQ += v.lenQ; });', 'soundLengthQ += v.lenQ + (v.index === 1 ? 0.5 : 0); });']], ''],
  ['PM3', true, 'a tie\'s end is found by pitch alone (the real continuation is struck again)', [["at.set(n.midi + '@' + n.abs.toFixed(3), n)", 'at.set(String(n.midi), n)'], ["at.get(n.midi + '@' + (cur.abs + cur.dur).toFixed(3))", 'at.get(String(n.midi))']], ''],
  ['PM4', true, 'the hand filter lets a cue part\'s notes through (follow mode asks for notes that are not the student\'s)', [["    if (n.hand === 'x') return false;                 /* a cue staff is read, not played */\n", '']], ''],
  ['PM5', true, 'a volta is chosen by the wrong pass (the first ending is played the second time)', [['openEnding.indexOf(pass) < 0)', 'openEnding.indexOf(pass + 1) < 0)']], ''],
  /* the compat rules */
  ['PM6', false, 'a repeat with no forward sign inside a loop goes to the first bar of the piece, not the loop\'s start', [['startStack[startStack.length - 1] : i0;\n          /* nested', 'startStack[startStack.length - 1] : 0;\n          /* nested']], ''],
  ['PM7', false, 'the graph rules are on unless compat is asked (a 6/4 hymn is counted in two)', [['legacyCompat: o.legacyCompat !== false', 'legacyCompat: o.legacyCompat === true']], ''],
  ['PM8', false, 'a bar played again starts at the tempo the last bar ended on', [['out.push({ q: v.soundQ, bpm: lastAt(v.startQ) });', 'out.push({ q: v.soundQ, bpm: out.length ? out[out.length - 1].bpm : lastAt(v.startQ) });']], ''],
  ['PM9', false, 'the soft pedal is down and the notes are as loud as ever', [['if (softAt(soft, writtenQ)) vel =', 'if (false && softAt(soft, writtenQ)) vel =']], ''],
  ['PM10', false, 'a marcato is only a little louder', [['if (n.marcato) vel += 22;', 'if (n.marcato) vel += 12;']], ''],
  ['PM11', false, 'a tied note sounds only its own length', [['cont.add(nx.head);\n        }\n        hold.set(n.head, q);', 'cont.add(nx.head);\n        }\n        hold.set(n.head, n.dur);']], ''],
  ['PM12', false, 'the sostenuto holds a note that was already over when it went down', [['n.abs <= s[0] + 1e-9 && n.abs + h > s[0] + 1e-9 && s[1] > upWritten', 'n.abs <= s[0] + 1e-9 && s[1] > upWritten']], ''],
  ['PM13', false, 'the pedal is copied into the first visit only', [['plan.ccs = pedalCCs(ccsWritten, visits);', 'plan.ccs = pedalCCs(ccsWritten, visits.slice(0, 1));']], ''],
  ['PM14', false, 'a pickup is counted from the start of its bar', [['const lead = i === 0 && lenQ < nominal - 1e-6 ? nominal - lenQ : 0;', 'const lead = 0;']], ''],
  ['PM15', false, 'a rolled chord is not flagged', [["arp: rolled.has(n.mi + '|' + n.b + '|' + (n.staff || 1))", 'arp: false']], ''],
  ['PM16', false, 'a note is held to its written length through the damper only when the pedal is down at the END of the note, not inside it', [['if (upWritten > s[0] + 1e-6 && upWritten < s[1] - 1e-6) { upWritten = s[1]; moved = true; break; }', 'if (upWritten > s[0] + 1e-6 && upWritten < s[1] - 1e-6) { moved = false; break; }']], ''],
  /* the fixes: the cause table must still hold, or the baseline's counts move */
  ['PM17', false, 'a D.C. after a volta reads the first ending on the way back', [['const pass = leg ? backPass : passNow();', 'const pass = leg ? 1 : passNow();']], ''],
  ['PM18', false, 'a Fine does not end the piece', [["if (here.some(j => j.kind === 'fine')) break;", 'if (false) break;']], ''],
  ['PM19', false, 'a To Coda is not taken', [["const toCoda = here.find(j => j.kind === 'tocoda' && j.to !== null && j.to >= i0 && j.to <= i1);", 'const toCoda = null;']], ''],
  ['PM20', false, 'the jumps are on unless they are asked off', [["jumps: o.jumps === 'once' ? 'once' : false", "jumps: o.jumps === false ? false : 'once'"]], ''],
  ['PM21', false, 'a grace that is crushed in does not shorten the note before it', [['            s.upQ = cut;', '            s.upQ = s.upQ;']], ''],
  ['PM22', false, 'an unslashed grace is played on the beat and the main note does not wait for it', [['mains.forEach(s => { s.q = base + spent;', 'mains.forEach(s => { s.q = s.q;']], ''],
  ['PM23', false, 'follow mode (FOLLOW_TIE) still skips a tie that leads nowhere', [['if (strikeTies ? !struck(plan, n) : n.tieStop) return;', 'if (n.tieStop) return;']], ''],
  ['PM24', false, 'follow mode (FOLLOW_REPEAT) loses track of which stretch a gate belongs to', [['last.b = v.startQ + v.lenQ; last.to = k; }', 'last.b = v.startQ + v.lenQ; }']], 'a detail of the gate (its visit and q) that the app\'s gates do not have, so the oracle cannot compare it; plan.test.js MUT-GATE-VISIT reads it'],
  ['PM25', false, 'a pair of graces is played backwards', [['grp.notes.sort((a, c) => a.grace.order - c.grace.order);', 'grp.notes.sort((a, c) => c.grace.order - a.grace.order);']], 'which grace sounds first is a detail of GRACE that the cause table does not look into (only where and how much may move); plan.test.js MUT-GRACE-ORDER reads it']
];

function mutate(source, edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error('STALE: the anchor ' + JSON.stringify(find.slice(0, 70)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  return text;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { ROWS.forEach(r => console.log(r[0] + (r[1] ? ' (core)' : '       ') + '  ' + r[2])); return; }
  const si = argv.indexOf('--sample');
  const sample = si >= 0 ? +argv[si + 1] : 8;
  const hi = argv.indexOf('--shard');
  const shard = hi >= 0 ? /^(\d+)\/(\d+)$/.exec(argv[hi + 1] || '') : null;
  if (hi >= 0 && (!shard || +shard[1] < 1 || +shard[1] > +shard[2])) throw new Error('--shard K/M');
  const wanted = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sample' && argv[i - 1] !== '--shard');
  let rows = ROWS;
  if (argv.includes('--core')) rows = rows.filter(r => r[1]);
  if (wanted.length) { rows = rows.filter(r => wanted.includes(r[0])); if (rows.length !== wanted.length) throw new Error('unknown row in ' + wanted.join(' ')); }
  if (shard) rows = rows.filter((r, i) => i % +shard[2] === +shard[1] - 1);
  const base = JSON.parse(fs.readFileSync(P.BASELINE, 'utf8'));
  const corp = P.corpus();
  const list = P.select(corp, { sample: sample }, base);
  const source = fs.readFileSync(P.PLAN_SRC, 'utf8').split('\r\n').join('\n');
  const srv = await require('./lib').serve();
  let bad = 0;
  try {
    const attempt = async planSource => {
      const r = await P.runParity({ corp: corp, list: list, windows: base.options.windows, url: srv.url, planSource: planSource });
      const v = P.verdict(r.recs, r.spies, corp, base, false);
      return { v: v, secs: r.secs };
    };
    const t0 = Date.now();
    const control = await attempt(source);
    const cdiff = control.v.hard.length + control.v.drift.length;
    console.log('control (nothing mutated): ' + (cdiff ? 'NOT CLEAN, ' + cdiff + ' problem(s), first: ' + (control.v.hard[0] || control.v.drift[0]) : 'clean') + ' on ' + list.length + ' files (' + control.secs.toFixed(0) + ' s)');
    if (cdiff) bad++;
    let killed = 0;
    for (const [id, core, what, edits, watched] of rows) {
      const t1 = Date.now();
      let planSource;
      try { planSource = mutate(source, edits); } catch (e) { console.log(id + ' STALE - ' + e.message); bad++; continue; }
      const r = await attempt(planSource);
      const hits = r.v.hard.length + r.v.drift.length;
      const first = (r.v.hard[0] || r.v.drift[0] || '').replace(/\s+/g, ' ').slice(0, 130);
      const dt = ((Date.now() - t1) / 1000).toFixed(0) + ' s';
      if (hits) { killed++; console.log(id + ' killed' + (core ? ' (core)' : '') + ' - ' + what + ' - ' + hits + ' problem(s), first: ' + first + ' (' + dt + ')'); }
      else if (!core && watched) console.log(id + ' not seen by parity - ' + what + ' - watched by: ' + watched + ' (' + dt + ')');
      else { bad++; console.log(id + ' SURVIVED' + (core ? ' (core)' : '') + ' - ' + what + ' (' + dt + ')'); }
    }
    console.log('\n' + killed + ' of ' + rows.length + ' mutants killed by the parity check' + (bad ? ', ' + bad + ' PROBLEM(S)' : ', the control clean') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  } finally {
    await srv.close();
  }
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { ROWS, mutate };
