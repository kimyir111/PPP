/* The recording call sites of the page, read from its source (G10a-4): every `toMusicXml(` call with its whole argument list, parentheses balanced (strings and comments skipped).
   The call sites used to be four literals `toMusicXml({..}, {..});`; with PPP.recording the options of three of them are an alternative or an Object.assign, and "Write the notation
   again" is a fifth. A test that wants "every recording call site asks for closeGaps / exactBars" reads them with this. */
'use strict';

function toMusicXmlCalls(html) {
  const calls = [];
  const re = /toMusicXml\(/g;
  let m;
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length, depth = 1, quote = null;
    while (i < html.length && depth) {
      const c = html[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (html.startsWith('/*', i)) i = html.indexOf('*/', i) + 1;
      else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    calls.push(html.slice(m.index, i));
  }
  return calls;
}

module.exports = { toMusicXmlCalls };
