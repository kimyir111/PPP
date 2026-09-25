/* G04 §22.2: the R reference corpus manifest, tests/engrave/corpus.json.

     node tests/engrave/tools/make-corpus.js           write it
     node tests/engrave/tools/make-corpus.js --check   exit 1 if the committed manifest is not what this writes

   R is committed catalogue music whose notation is its editor's (CLEAN_INPUT): nothing upstream (G3, a recording)
   can put an error into it. The rule, written into the manifest with its seed:
     - a file the provenance record calls eligible, not quarantined (tests/bench/corpus/provenance.json), that exists;
     - not a G0 hold-out reference (tests/bench/corpus/references.json holdout:true) - G0's hold-out stays
       independent, and no hold-out value is ever reported per file;
     - per stratum, the files ordered by sha256(seed + ':' + path), the first n taken. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(REPO, 'tests', 'engrave', 'corpus.json');
const SEED = 'g4-r-2026-09-25';
/* G04 §22.2: stratum, where, how many, what it mainly measures */
const STRATA = [
  ['hymns', 'catalog/hymns/', 10, 'SATB four voices on two staves'],
  ['beyer', 'catalog/method/beyer/', 10, 'plain beams, repeats and voltas'],
  ['czerny599', 'catalog/method/czerny599/', 10, 'secondary beam breaks, articulations'],
  ['czerny849', 'catalog/method/czerny849/', 8, 'triplets, fingering, grace notes, slurs, 8va'],
  ['sonatina', 'catalog/method/sonatina/', 10, 'dense marks: slurs, dynamics, hairpins, fingering, grace notes'],
  ['burgmuller25', 'catalog/method/burgmuller25/', 7, 'tuplet display options, lyrics, pedal'],
  ['hanon', 'catalog/method/hanon/', 3, 'long beam chains, fingering'],
  ['catalog', 'catalog/', 3, 'Fur Elise, Gymnopedie, Happy Birthday']
];

function build() {
  const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'bench', 'corpus', 'provenance.json'), 'utf8'));
  const refs = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'bench', 'corpus', 'references.json'), 'utf8'));
  const holdout = new Set(refs.references.filter(r => r.holdout).map(r => r.path));
  const quarantined = prov.entries.filter(e => e.quarantine_reason).map(e => e.path);
  const eligible = prov.entries.filter(e => e.eligible && !e.quarantine_reason && /\.(musicxml|xml|mxl)$/i.test(e.path) &&
    fs.existsSync(path.join(REPO, e.path))).map(e => e.path);
  const key = p => crypto.createHash('sha256').update(SEED + ':' + p).digest('hex');
  const strata = STRATA.map(([name, dir, n, what]) => {
    const pool = eligible.filter(p => (name === 'catalog' ? p.startsWith(dir) && p.slice(dir.length).indexOf('/') < 0 : p.startsWith(dir)));
    const usable = pool.filter(p => !holdout.has(p));
    if (usable.length < n) throw new Error(name + ': ' + usable.length + ' usable files, ' + n + ' wanted');
    const files = usable.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, n).sort();
    return { name: name, n: n, measures: what, pool: pool.length, heldOut: pool.length - usable.length, files: files };
  });
  return {
    schema: 'engrave-corpus/1',
    doc: 'docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md §22.2 - written by tests/engrave/tools/make-corpus.js',
    seed: SEED,
    rule: 'eligible and not quarantined (tests/bench/corpus/provenance.json), not a G0 hold-out reference (references.json), ' +
      'per stratum ordered by sha256(seed + ":" + path), first n',
    excluded: { quarantined: quarantined.length, holdoutInStrata: strata.reduce((s, x) => s + x.heldOut, 0) },
    strata: strata,
    files: strata.flatMap(s => s.files)
  };
}

if (require.main === module) {
  const text = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.indexOf('--check') > 0) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : null;
    console.log(cur === text ? 'tests/engrave/corpus.json is what this tool writes' : 'tests/engrave/corpus.json DIFFERS');
    process.exit(cur === text ? 0 : 1);
  }
  fs.writeFileSync(OUT, text);
  const m = JSON.parse(text);
  console.log('wrote ' + path.relative(process.cwd(), OUT) + ': ' + m.files.length + ' files; ' + m.strata.map(s => s.name + ' ' + s.files.length).join(', '));
}
module.exports = { build, SEED, STRATA };
