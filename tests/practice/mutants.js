/* G11a-0: mutation checks of the practice harness. A rule of the legacy player, matcher or follow gates is BROKEN on its way to the browser (a
   proxy rewrites one line of the app's page; no file is touched), and the recorder (tests/practice/record.js check) and, for the rows that name
   them, the browser suites must go red. A mutant that survives is a rule nothing watches; a row whose line no longer exists in the page is STALE
   and fails too (a mutation row that silently stops applying would pass as a mutant nobody killed).

     node tests/practice/mutants.js               every row, with the suites the rows name (about 5-7 minutes)
     node tests/practice/mutants.js --no-suites   the recorder only (about 20 s per row)
     node tests/practice/mutants.js M1 P3         only these rows
     node tests/practice/mutants.js --list

   Exit code 0 when the unmutated control is clean and every row is killed. The page edits are one-liners on purpose: the file is checked out
   with CRLF on some machines and LF on others. */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const L = require('./lib');
const R = require('./record');
const fs = require('fs');

/* id, what the mutant breaks, [[from, to], ...] (each `from` is ONE line of the page, exactly once), and the suites that also notice it (measured on
   2026-10-08: the others stayed green, which is the point of the recorder - no browser suite watches how the matcher closes a missed note, filters
   a hand or scales a tempo, how a tie is struck, or what follow mode asks of the other hand; a row names a suite only if that suite went red).
   A row is killed when the recorder or a suite named in it goes red. */
const ROWS = [
  /* the matcher (PerformanceEngine) */
  ['M1', 'the matcher takes a key for any expected note (pitch ignored)', [['if (x.matched || x.midi !== ev.midi) continue;', 'if (x.matched) continue;']], ['learning', 'midi']],
  ['M2', 'an early note is called late and a late one early', [["best.verdict = Math.abs(bestD) <= this.timing.perfect ? 'on' : (bestD < 0 ? 'early' : 'late');", "best.verdict = Math.abs(bestD) <= this.timing.perfect ? 'on' : (bestD < 0 ? 'late' : 'early');"]], []],
  ['M3', 'the first candidate, not the nearest one in time, takes the key', [['if (Math.abs(d) < Math.abs(bestD)) { best = x; bestD = d; }', 'if (!best) { best = x; bestD = d; }']], []],
  ['M4', 'a note nobody played is never closed as missed', [['if (tMs > x.tMs + w + (x.arp ? this.timing.roll : 0)) {', 'if (false) {']], []],
  ['M5', 'a wrong key at the right moment counts as a stray (extra) note', [['if (Math.abs(ev.t - x.tMs) <= w) { near = true; break; }', 'if (false) { near = true; break; }']], []],
  ['M6', 'the "on the beat" window is 100 ms, not 55', [['perfect: 55,', 'perfect: 100,']], []],
  ['M7', 'the matcher expects both hands whatever hand is practised', [['.filter(s => this._handOk(s.note, run.hands))', '']], []],
  ['M8', 'a rolled chord gets no extra time for its top notes', [['if (d < -w || d > w + (x.arp ? this.timing.roll : 0)) continue;', 'if (d < -w || d > w) continue;']], []],
  ['M9', 'a practice tempo does not move the expected times', [['const scale = (run.tempo || score.tempo || 84) / Math.max(1, score.tempo || run.tempo || 84);', 'const scale = 1;']], []],
  /* the legacy player (PianoScore) the matcher and the falling notes are built on */
  ['P1', 'a printed pedal change no longer lifts the damper (MX-1)', [['if (e.lift && down != null && e.q > down + 1e-6) {', 'if (false) {']], ['playback-scheduler']],
  ['P2', 'a volta is chosen one pass late', [['const skip = !!(nos && nos.length && nos.indexOf(pass) < 0);', 'const skip = !!(nos && nos.length && nos.indexOf(pass + 1) < 0);']], []],
  ['P3', 'the second note of a tie is struck again', [['struck(plan, n) { return !n.rest && !(n.tieStop && plan.cont.has(n)); }', 'struck(plan, n) { return !n.rest; }']], []],
  ['P4', 'a backward repeat plays once', [['const times = bar.repeatEnd > 0 ? bar.repeatEnd : 2;', 'const times = 1;']], []],
  ['P5', 'an accent is 10 louder, not 14', [['else if (n && n.accent) vel += 14;', 'else if (n && n.accent) vel += 10;']], []],
  ['P6', 'a hairpin ends where it starts', [['base = Math.round(w.v0 + (w.v1 - w.v0) * Math.max(0, Math.min(1, t)));', 'base = w.v0;']], []],
  ['P7', 'an 8va note is struck where it is printed, not where it sounds (MX-1 D-1)', [['midi: n.soundingMidi != null ? n.soundingMidi : n.midi,', 'midi: n.writtenMidi != null ? n.writtenMidi : n.midi,']], ['playback-scheduler']],
  ['P8', 'a tempo mark in the middle of a repeat is forgotten at the start of its visit', [['out.push({ q: v.soundQ, bpm: lastAt(v.startQ) });', 'out.push({ q: v.soundQ, bpm: fallback });']], []],
  ['P9', 'compound metres (6/8, 9/8) are counted in beats of one eighth', [['if (ts.beatType >= 8 && ts.beats % 3 === 0 && ts.beats > 3) { unit *= 3; count = ts.beats / 3; }', 'if (false) { unit *= 3; count = ts.beats / 3; }']], []],
  ['P10', 'a pickup bar is counted from its bar line', [['const lead = mm.index === 0 && mm.lenQ < full - 1e-6 ? full - mm.lenQ : 0;', 'const lead = 0;']], []],
  /* follow mode's gates */
  ['G1', 'follow mode asks for the second note of a tie', [['if (n.tieStop) return;', '']], ['follow']],
  ['G2', 'follow mode asks for the other hand too', [['if (!this.handOk(n, S.hands)) return;', '']], []],
  ['G3', 'follow mode makes no rest gates', [['if (t1 - t0 < 1e-4) return;', 'return;']], ['follow']]
];

function runSuites(port, names) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'run-suites.js'), '--port', String(port), '--only', names.join(','), '--log-dir', path.join(__dirname, 'out', 'mutant-suites')],
      { cwd: L.ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({ code, text }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { ROWS.forEach(r => console.log(r[0] + '  ' + r[1])); return; }
  const noSuites = argv.includes('--no-suites');
  const wanted = argv.filter(a => !a.startsWith('--'));
  const rows = wanted.length ? ROWS.filter(r => wanted.includes(r[0])) : ROWS;
  if (wanted.length && rows.length !== wanted.length) throw new Error('unknown row in ' + wanted.join(' '));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const corp = L.corpus();
  const base = JSON.parse(fs.readFileSync(R.BASELINE, 'utf8'));
  const opts = { windows: base.options.windows, beginWindows: base.options.beginWindows, matchWindows: base.options.matchWindows };
  const srv = await L.serve();
  const origin = new URL(srv.url).origin;
  let bad = 0;
  const report = [];
  const attempt = async edits => {
    const proxy = await L.mutatingProxy(origin, edits);
    try {
      const url = proxy.url(srv.url);
      const recs = await R.withPage(url, page => R.recordAll(page, corp, opts));
      const counts = proxy.counts();
      const stale = edits.length && (!counts || counts.some(c => c !== 1));
      return { diffs: stale ? [] : R.compare(base, recs, corp), stale: stale ? 'applied ' + JSON.stringify(counts) + ' times' : null, port: proxy.port, proxy };
    } catch (e) { await proxy.close(); throw e; }
  };
  try {
    const t0 = Date.now();
    const control = await attempt([]);
    await control.proxy.close();
    console.log('control (nothing mutated): ' + (control.diffs.length ? 'NOT CLEAN, ' + control.diffs.length + ' differences, first: ' + control.diffs[0] : 'clean') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    if (control.diffs.length) bad++;
    for (const [id, what, edits, suites] of rows) {
      const t1 = Date.now();
      const r = await attempt(edits.map(e => [e[0], e[1]]));
      let killedBy = [];
      if (r.stale) { await r.proxy.close(); report.push([id, 'STALE', what + ' - ' + r.stale]); bad++; console.log(id + ' STALE: ' + r.stale); continue; }
      if (r.diffs.length) killedBy.push('recorder (' + r.diffs.length + ' files, first ' + r.diffs[0].split(':')[0].replace(/^.*\//, '') + ')');
      let suiteNote = '';
      if (suites.length && !noSuites) {
        const s = await runSuites(r.port, suites);
        if (s.code !== 0) killedBy.push('suites ' + suites.join('+'));
        else suiteNote = ' (suites ' + suites.join('+') + ' stayed green)';
      }
      await r.proxy.close();
      const survived = !killedBy.length;
      if (survived) bad++;
      report.push([id, survived ? 'SURVIVED' : 'killed', what + ' - ' + (killedBy.join('; ') || 'nothing noticed') + suiteNote]);
      console.log(id + ' ' + (survived ? 'SURVIVED' : 'killed') + ' - ' + what + ' - ' + (killedBy.join('; ') || 'nothing noticed') + suiteNote + ' (' + ((Date.now() - t1) / 1000).toFixed(0) + ' s)');
    }
  } finally {
    await srv.close();
  }
  const killed = report.filter(r => r[1] === 'killed').length;
  console.log('\n' + killed + ' of ' + rows.length + ' mutants killed' + (bad ? ', ' + bad + ' PROBLEM(S)' : ', the control clean'));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
