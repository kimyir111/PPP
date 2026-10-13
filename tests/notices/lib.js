/* G13-3 test helpers: a tree to read (the repository, or a copy a mutation test broke on purpose: PPP_NOTICES_ROOT), and small copies of it. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
/* the tree the tests look at: the repository itself unless a mutant runner points them at its copy */
const ROOT = process.env.PPP_NOTICES_ROOT ? path.resolve(process.env.PPP_NOTICES_ROOT) : REPO;

function copyInto(dest, rel, opts) {
  const from = path.join(REPO, rel), to = path.join(dest, rel);
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) {
      if (n === 'node_modules' || n.startsWith('.git')) continue;
      if (opts && opts.skip && opts.skip.test(rel + '/' + n)) continue;
      copyInto(dest, rel + '/' + n, opts);
    }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
/* a temporary tree holding only these files and folders of the repository */
function makeCopy(paths, opts) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-notices-'));
  paths.forEach(p => { if (fs.existsSync(path.join(REPO, p))) copyInto(dest, p, opts); });
  return dest;
}
function rmCopy(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ } }

/* what tools/notices/build.js reads */
const BUILD_INPUTS = ['tools/notices/notices.json', 'tools/notices/build.js', 'vendor', 'audio/piano/README.md', 'catalog/hymns/README.md', 'catalog/hymns/index.json',
  'catalog/method/index.json', 'catalog/index.json', 'catalog/shared-seeds.json', 'Piano Coach App.dc.html', 'support.js', 'THIRD_PARTY_NOTICES.md'];

/* Replace the first occurrence of `from` (once, it must be there once) in a file of a copy; a Windows checkout's CRLF is honoured. */
function edit(dir, rel, from, to) {
  const f = path.join(dir, rel);
  let src = fs.readFileSync(f, 'utf8');
  const CRLF = src.indexOf('\r\n') >= 0;
  if (CRLF) { from = from.split('\n').join('\r\n'); to = to.split('\n').join('\r\n'); }
  const i = src.indexOf(from);
  if (i < 0) throw new Error('the text to change is not in ' + rel + ': ' + JSON.stringify(from.slice(0, 80)));
  if (src.indexOf(from, i + 1) >= 0) throw new Error('the text to change is more than once in ' + rel + ': ' + JSON.stringify(from.slice(0, 80)));
  fs.writeFileSync(f, src.slice(0, i) + to + src.slice(i + from.length));
}

module.exports = { REPO, ROOT, makeCopy, rmCopy, edit, BUILD_INPUTS };
