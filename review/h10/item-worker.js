/* G10a-5 (H-10): builds ONE review item (both ways of writing one recording down, with the arranger's copy of each) in its own process, so
   the builder can run several at once (the arranger takes 10-40 s a piece and is synchronous).

   stdin: JSON job { id, title, heard, excerpt?, level? }   stdout: JSON { ok: true, result } or { ok: false, error }
   The result is review/lib/h10-item.js buildItem's, as plain JSON (G10b-0: buildEngineItem's for a job with `compare: 'engine'` and the helper's notes in `heardB`). */
'use strict';
const path = require('path');
const { buildItem, buildEngineItem } = require(path.join(__dirname, '..', 'lib', 'h10-item.js'));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let out;
  try { const job = JSON.parse(input); out = { ok: true, result: await (job.compare === 'engine' ? buildEngineItem(job) : buildItem(job)) }; }
  catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
  process.stdout.write(JSON.stringify(out));
});
