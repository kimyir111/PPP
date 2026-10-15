'use strict';
/* G13-4b2 / G13-7b test helper (Node only): the text of one of the page's inline head scripts. The source is the real one - read out of the page by a phrase of its own opening comment - so a
   test cannot drift from what ships. PPP_LOAD_ROOT (tests/load/lib.js) points at a copy of the tree, as the mutation runner does. */
const fs = require('fs');
const path = require('path');
const { REPO } = require('./lib');

function pageText() { return fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8'); }

/* the inline <script> of the head whose text contains `marker` (exactly one) */
function script(marker) {
  const page = pageText();
  const head = page.slice(0, page.indexOf('</head>'));
  const hits = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.indexOf(marker) >= 0);
  if (hits.length !== 1) throw new Error('the head has ' + hits.length + ' inline scripts with "' + marker + '"');
  return hits[0];
}

module.exports = { pageText, script };
