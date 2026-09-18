/* Public-domain catalog search and alignment — no commercial APIs. */
const fs = require('fs');
const path = require('path');
const Search = require('../score-search.js');

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

const dir = path.join(__dirname, '..', 'catalog');
const catalog = Search.loadCatalogSync(fs, path, dir);

console.log('\n── public-domain catalog ──');
ok('the catalog loads', !!(catalog && catalog.scores && catalog.scores.length), (catalog.scores || []).length + ' scores');
ok('entries declare CC0 or public domain', (catalog.scores || []).every(s => /CC0|public domain/i.test(s.license || '')),
  (catalog.scores || []).map(s => s.license).join(', '));

const hit = Search.search('Erik Satie Gymnopédie No. 1', catalog);
ok('Gymnopédie / Satie is found', !!(hit && hit.entry && hit.entry.xml && hit.retrieved), hit && hit.entry && hit.entry.title);
ok('the hit is the catalog file, not a scrape', hit && hit.entry && hit.entry.id === 'gymnopedie-1' && hit.entry.file === 'gymnopedie-1.musicxml');

const miss = Search.search('zzzxq-not-a-piece-999 xyzzy', catalog);
ok('a nonsense title returns no match', miss == null, String(miss));

const xml = hit.entry.xml;
const aligned = Search.align(xml, { duration: 24 });
ok('alignment produces barStarts covering the recording',
  aligned.barStarts && aligned.barStarts.length >= 2 && aligned.barStarts[aligned.barStarts.length - 1] >= 24,
  aligned.barStarts && aligned.barStarts[0] + ' … ' + aligned.barStarts[aligned.barStarts.length - 1] + ' / ' + aligned.measures + ' bars');
ok('the catalog score is 3/4', aligned.beats === 3 && aligned.beatType === 4, aligned.beats + '/' + aligned.beatType);

console.log('\n────────────────────────────────────────');
if (errors.length) {
  console.log(errors.length + ' PROBLEM(S):');
  [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  process.exit(1);
}
console.log('Catalog search finds public-domain scores and aligns them; a miss falls through.');
process.exit(0);
