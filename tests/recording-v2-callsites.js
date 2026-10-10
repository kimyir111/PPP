/* The recording call sites of the page, read from its source (G10a-4): every `toMusicXml(` call with its whole argument list, parentheses balanced (strings and comments skipped).
   The call sites used to be four literals `toMusicXml({..}, {..});`; with PPP.recording the options of most of them are an alternative or an Object.assign, "Write the notation
   again" is a fifth, and the one-note arranger's hands fallback a sixth. A test that wants "every recording call site asks for closeGaps / exactBars" reads them with this.

   toMusicXmlCalls(html)  the text of each call
   branchOptions(call)    the options each call passes, evaluated for each branch of the page's own condition: { classic, v2 } (the page's flag - useV2, wantV2, v2 or this.recordingRewriteV2(S) - false / true).
                          A call whose options do not depend on the flag has the same object in both. The branch-agnostic test (a regex over the whole call) cannot tell
                          `Object.assign({.., exactBars: true}, v2 ? {recording:'v2'} : {})` from `Object.assign({..}, v2 ? {recording:'v2', exactBars: true} : {})`: this can.
   node tests/recording-v2-callsites.js [--json]  prints the table (one line a call), or the JSON of it (tests/bench/unit/test_app_suites.py reads it) */
'use strict';
const fs = require('fs');
const path = require('path');

function skipTo(html, i) {            /* the index after the string, comment or template that starts at i, or i if none starts there */
  const c = html[i];
  if (html.startsWith('/*', i)) return html.indexOf('*/', i) + 2;
  if (html.startsWith('//', i) && html[i - 1] !== ':') { const e = html.indexOf('\n', i); return e < 0 ? html.length : e; }
  if (c === "'" || c === '"' || c === '`') {
    let k = i + 1;
    while (k < html.length && html[k] !== c) k += html[k] === '\\' ? 2 : 1;
    return k + 1;
  }
  return i;
}

function toMusicXmlCalls(html) {
  const calls = [];
  const re = /toMusicXml\(/g;
  let m;
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < html.length && depth) {
      const j = skipTo(html, i);
      if (j !== i) { i = j; continue; }
      const c = html[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    calls.push(html.slice(m.index, i));
  }
  return calls;
}

/* the top-level arguments of a call's text (`toMusicXml(a, b)` -> ['a', 'b']) */
function callArguments(call) {
  const body = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'));
  const out = [];
  let depth = 0, start = 0, i = 0;
  while (i < body.length) {
    const j = skipTo(body, i);
    if (j !== i) { i = j; continue; }
    const c = body[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
    i++;
  }
  out.push(body.slice(start));
  return out.map(s => s.replace(/\/\*[\s\S]*?\*\//g, '').trim());
}

/* the options a call passes with the page's flag false (classic) and true (v2); the free names of the page's options are given plain values */
function branchOptions(call) {
  const expr = callArguments(call)[1];
  if (!expr) throw new Error('no options argument: ' + call.slice(0, 80));
  const run = flag => {
    const scope = {
      useV2: flag, wantV2: flag, v2: flag, title: 'T', what: { mode: 'solo' }, lock: { beats: 4, beatType: 4, bpm: 90, firstDownbeat: 0 }, arrangement: { level: 'beginner', style: 'balanced' },
      S: { score: { title: 'T' } },
      /* a recording, not a song-mode one (a song's layers add songLayers: true) */
      heard: { notes: [] }, isSongHeard: h => !!(h && h.song), songNotation: () => ({})
    };
    const self = { recordingRewriteV2: () => flag };
    const f = new Function(...Object.keys(scope), 'return (' + expr + ');');
    return JSON.parse(JSON.stringify(f.apply(self, Object.values(scope))));
  };
  return { classic: run(false), v2: run(true) };
}

function appHtml(repo) { return fs.readFileSync(path.join(repo || path.resolve(__dirname, '..'), 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n'); }

module.exports = { toMusicXmlCalls, callArguments, branchOptions, appHtml };

if (require.main === module) {
  const calls = toMusicXmlCalls(appHtml(process.argv[3]));
  const table = calls.map(c => Object.assign({ call: c.slice(0, 60).replace(/\s+/g, ' ') }, branchOptions(c)));
  if (process.argv.includes('--json')) console.log(JSON.stringify(table));
  else table.forEach(t => console.log(t.call, '\n  classic', JSON.stringify(t.classic), '\n  v2     ', JSON.stringify(t.v2)));
}
