/* Which files of the repository the static server hands out (G13-5; docs/GOALS/G13_PRODUCTIZATION.md D16, TD26).

   Until G13-5 the server served the whole checkout except a blocklist of five folders, so /server.js, /render.yaml, /package.json and
   /docs/* (deploy ids, review history) were public. Now a file is served only if it is on this list, and anything else is a 404 - the same
   404 as a file that is not there, so the answer does not say that it exists.

   The list is what the PAGE needs, found in three places (tests/static-allow.test.js checks all three on every run, so a lazy module that
   is added without a line here fails the gate instead of turning into a 404 on the live site):
     1. the <script src> tags of Piano Coach App.dc.html and the root scripts they name;
     2. the lists the page loads on demand: SINGLE_SCRIPTS, RECORDING_SCRIPTS, RECORDING_OPTIONAL_SCRIPTS, ENGRAVE_FILES, the weights files,
        the catalogues, the piano samples, the hand pictures, the language files;
     3. every other file-like string of the page and of the root scripts that names a file of this repository.
   What the page does not load stays private: the server and its modules, deploy files, Python, docs/, tests/, tools/, the helper's
   sources, the training and corpus tools under <dir>/tools/, the README of each folder, the ABC sources of the catalogues.

   A rule is a pattern for one folder, not a list of 700 files: a new hymn, a new method-book piece or a new module in a folder the page
   loads from is served the day it is added, as before. A file that matches no rule is not served.

   `rel` is always the path from the repository root with "/" between the parts, taken from the file the request resolves to (not from the
   text of the request), and matching is case-sensitive: "Server.js" on a case-insensitive disk is not on the list either. */
'use strict';

/* the page, and the scripts that sit beside it */
const ROOT_FILES = new Set([
  'Piano Coach App.dc.html',
  'support.js', 'i18n.js', 'library-backup.js', 'audio-score.js', 'score-search.js', 'lessons.js', 'course.js',
  /* G13-3 makes it: the licence notices the site shows (planned; not there yet) */
  'THIRD_PARTY_NOTICES.md'
]);
/* in ROOT_FILES but not in the repository yet (the test does not ask for these to exist) */
const PLANNED = new Set(['THIRD_PARTY_NOTICES.md']);

/* the folders whose own .js files the page loads (script tags, SINGLE_SCRIPTS, RECORDING_SCRIPTS, ENGRAVE_FILES): the files directly in
   the folder, never <folder>/tools/ (training, corpus and benchmark tools) and never a README */
const CODE_DIRS = 'scoregraph|engrave|playability|difficulty|songgraph|arrangement|realize|rec|candidates|critics|repair';

const RULES = [
  new RegExp('^(?:' + CODE_DIRS + ')/[\\w.-]+\\.js$'),
  /* the trained weights the stages read (rec/weights/*.json, difficulty/weights/g6a-v1.json) */
  /^(?:rec|difficulty)\/weights\/[\w.-]+\.json$/,
  /* the one training table the arranger's real bands need (loadArrangerReference) - the only file of a tools/ folder the page asks for */
  /^difficulty\/tools\/dataset\/method-books\.json$/,
  /* the four language files */
  /^i18n\/[\w-]+\.json$/,
  /* the piano recordings */
  /^audio\/piano\/[\w-]+\.mp3$/,
  /* pictures (the hands of the fingering diagrams; self-hosted fonts later, G13-4) */
  /^assets\/(?:[\w-]+\/)*[\w.-]+\.(?:png|jpe?g|svg|webp|ico|woff2?)$/,
  /* the sample scores (the browser suites fetch samples/prelude-fragment.musicxml; they are public examples) */
  /^samples\/[\w.-]+\.(?:musicxml|xml|mxl)$/,
  /* the catalogues: the index of each, the scores they name. Not catalog/shared-seeds.json (the server reads it from disk), not the
     builders, not the ABC sources */
  /^catalog\/(?:index|hymns\/index|method\/index)\.json$/,
  /^catalog\/[\w.-]+\.musicxml$/,
  /^catalog\/hymns\/[\w.-]+\.musicxml$/,
  /^catalog\/method\/[\w-]+\/[\w.-]+\.mxl$/,
  /* third-party libraries kept in the repository (VexFlow now; React, pdf.js, fonts: G13-1, G13-4, G13-8) with the licence that must travel
     with each. Not the README */
  /^vendor\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|mjs|css|json|woff2?|txt)$/,
  /^vendor\/(?:[\w.-]+\/)*(?:LICENSE|NOTICE)(?:[-.][\w.-]+)?$/
];

/* Is this file (path from the root, "/" between parts) one the static server may hand out? */
function isServed(rel) {
  if (typeof rel !== 'string' || !rel || rel.indexOf('\\') >= 0 || rel.indexOf('\0') >= 0 || rel.charAt(0) === '/') return false;
  /* a part that starts with a dot (.git, .env, ..) is never served, whatever follows */
  if (rel.split('/').some(p => !p || p.charAt(0) === '.')) return false;
  if (ROOT_FILES.has(rel)) return true;
  return RULES.some(rx => rx.test(rel));
}

module.exports = { isServed, ROOT_FILES, PLANNED, RULES, CODE_DIRS };
