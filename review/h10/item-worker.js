/* G10a-5 (H-10): builds ONE review item (both ways of writing one recording down, with the arranger's copy of each) in its own process, so
   the builder can run several at once (the arranger takes 10-40 s a piece and is synchronous).

   stdin: JSON job { id, title, heard, excerpt?, level? }   stdout: JSON { ok: true, result } or { ok: false, error }
   The result is review/lib/h10-item.js buildItem's, as plain JSON. */
'use strict';
const path = require('path');
const { buildItem } = require(path.join(__dirname, '..', 'lib', 'h10-item.js'));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let out;
  try { out = { ok: true, result: await buildItem(JSON.parse(input)) }; }
  catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
  process.stdout.write(JSON.stringify(out));
});
