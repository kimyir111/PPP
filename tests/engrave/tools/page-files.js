/* The engraver's files as the app loads them under renderer 'engrave' (G4d-2, docs/GOALS/G04 §16; DECISIONS G4-D2-5).

     node tests/engrave/tools/page-files.js            print each file's content hash
     node tests/engrave/tools/page-files.js --check    exit 1 unless the app's ENGRAVE_FILES names these files, in this
                                                      order, each with its current hash (also a test: app.test.js)
     node tests/engrave/tools/page-files.js --write    write the hashes into the app's ENGRAVE_FILES

   The app asks for ./engrave/<name>.js?h=<hash>, and server.js lets the browser keep a response for good only when <hash>
   is the file's own: a URL names one content, so a kept copy is never stale, and a stale list costs caching, never
   correctness. The hash is the first 12 hex of the sha256 of the file with CRLF read as LF - a Windows checkout and the
   deployed Linux one hash alike. Any change to an engrave/ file the page loads must be followed by --write (the test
   says which). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..', '..');
const APP = path.join(REPO, 'Piano Coach App.dc.html');
/* each after what it reads (engrave/index.js's browser order), then the page adapter */
const ORDER = ['metrics', 'metrics-text', 'space', 'breaks', 'skyline', 'canon', 'notation', 'curves', 'marks', 'sysmarks', 'layout', 'practice',
  'outlines', 'svg', 'page'];

const hashOf = buf => crypto.createHash('sha256').update(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex').slice(0, 12);
const fileHash = name => hashOf(fs.readFileSync(path.join(REPO, 'engrave', name + '.js')));

/* the app's list: [[name, hash]] and where it is */
function appList(text) {
  const a = text.indexOf('const ENGRAVE_FILES = [');
  if (a < 0) throw new Error('the app has no ENGRAVE_FILES');
  const z = text.indexOf('];', a);
  const body = text.slice(a, z);
  const list = [...body.matchAll(/\['([\w-]+)', '([0-9a-f]{12})'\]/g)].map(m => [m[1], m[2]]);
  return { list: list, a: a, z: z };
}

function check() {
  const text = fs.readFileSync(APP, 'utf8');
  const { list } = appList(text);
  const problems = [];
  if (list.map(x => x[0]).join() !== ORDER.join()) problems.push('the app loads ' + list.map(x => x[0]).join(', ') + '; expected ' + ORDER.join(', '));
  list.forEach(([name, h]) => { const want = fileHash(name); if (want !== h) problems.push('engrave/' + name + '.js is ' + want + ', the app says ' + h); });
  return problems;
}

function write() {
  const raw = fs.readFileSync(APP, 'utf8');
  const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  const { a, z } = appList(text);
  const block = 'const ENGRAVE_FILES = [\n' + ORDER.map((n, i) => "  ['" + n + "', '" + fileHash(n) + "']" + (i + 1 < ORDER.length ? ',' : '')).join('\n') + '\n';
  const out = text.slice(0, a) + block + text.slice(z);
  fs.writeFileSync(APP, out.replace(/\n/g, eol));
}

if (require.main === module) {
  if (process.argv.includes('--write')) { write(); console.log('wrote ' + ORDER.length + ' hashes into ENGRAVE_FILES'); }
  const problems = check();
  if (process.argv.includes('--check') || process.argv.includes('--write')) {
    problems.forEach(p => console.log('  ' + p));
    console.log(problems.length ? 'STALE: run node tests/engrave/tools/page-files.js --write' : 'ENGRAVE_FILES matches engrave/');
    process.exit(problems.length ? 1 : 0);
  }
  ORDER.forEach(n => console.log(n.padEnd(14) + fileHash(n)));
}

module.exports = { ORDER, hashOf, fileHash, appList, check };
