/* G9c: runs the app's in-page ScoreArranger (extracted read-only by tests/playability/score-arranger-extract.js,
   via realize/tools/legacy.js) at its four native levels for ONE wire score, in its own process.

   Why a process: ScoreArranger has hung before on real corpus pieces (docs/GOALS/G09 section 12 round 2, TD15) and a hang
   in synchronous JS cannot be interrupted in-process. The parent (review/lib/arrange.js) gives this a time limit and
   treats a timeout as "this piece cannot be reviewed", never as a result.

   stdin: JSON { ws: <wire score>, levels: [...], style }   stdout: JSON { notes: { <level>: [note, ...] } } */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', '..', 'realize', 'tools', 'legacy.js'));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const job = JSON.parse(input);
  const out = { notes: {} };
  job.levels.forEach(level => {
    try { out.notes[level] = L.runScoreArranger(job.ws, level, job.style || 'balanced').notes; }
    catch (e) { out.notes[level] = { error: String(e && e.message || e) }; }
  });
  process.stdout.write(JSON.stringify(out));
});
