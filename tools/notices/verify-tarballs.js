#!/usr/bin/env node
/* G13-8: proves, from the npm registry, that the third-party files under vendor/ that came from an npm package are the published ones.

     node tools/notices/verify-tarballs.js [--root DIR] [--only pdfjs-3.11.174]

   vendor/README.md names, in each library's section, the tarball it was taken from and its integrity ("Tarball: `<url>`, integrity `sha512-...`")
   and, in the table of files, the path of each file inside that tarball (the column "In the tarball"). This tool downloads each tarball,
     1. checks that its sha512 is the integrity the README records (which is the registry's own `dist.integrity`: npm refuses a tarball that is not), and
     2. checks that every file of the table is, byte for byte, the file of that path in the tarball.
   It needs the network, so it is not a step of the gate; tests/engrave/vendor-optional.test.js runs it when PPP_VENDOR_ONLINE=1 (and the offline half of
   that test - the sha256 of each file against the README, every run - is what the gate keeps).

   Exit 0: every library verified. Exit 1: a mismatch or a tarball that could not be fetched (each is named). Node only, no dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

const lf = s => String(s).replace(/\r\n?/g, '\n');

/* [{ folder, tarball, integrity, files: [{ file, tar, sha256 }] }] from the sections of vendor/README.md that have a "Tarball:" line */
function libraries(root) {
  const md = lf(fs.readFileSync(path.join(root, 'vendor', 'README.md'), 'utf8'));
  const out = [];
  const parts = md.split(/^## /m).slice(1);
  parts.forEach(sec => {
    const folder = sec.split('\n')[0].replace(/\/$/, '').trim();
    const t = /^Tarball: `([^`]+)`, integrity `(sha512-[^`]+)`/m.exec(sec);
    if (!t) return;
    const files = [];
    sec.split('\n').forEach(line => {
      if (!/^\|/.test(line)) return;
      const cells = line.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const f = /^`([^`]+)`$/.exec(cells[0] || '');
      const tar = /^`([^`]+)`$/.exec(cells[4] || '');
      const sha = /^`([0-9a-f]{64})`$/.exec(cells[3] || '');
      if (f && tar && sha) files.push({ file: f[1], tar: tar[1], sha256: sha[1] });
    });
    out.push({ folder: folder, tarball: t[1], integrity: t[2], files: files });
  });
  return out;
}

function fetch(url, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ppp-vendor-verify' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).href, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/* a tar archive (ustar, as npm packs it): { path -> Buffer }. Reads only regular files; GNU long names and pax headers are handled for "path". */
function untar(buf) {
  const files = new Map();
  let off = 0, longName = null, paxPath = null;
  while (off + 512 <= buf.length) {
    const h = buf.slice(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, n) => { const s = h.slice(a, a + n); const z = s.indexOf(0); return s.slice(0, z < 0 ? n : z).toString('utf8'); };
    let name = str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(345, 155);
    if (prefix) name = prefix + '/' + name;
    const body = buf.slice(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'));
      if (m) paxPath = m[1];
      continue;
    }
    if (type === '0' || type === '\0') files.set(paxPath || longName || name, body);
    longName = null; paxPath = null;
  }
  return files;
}

async function verify(root, opts) {
  opts = opts || {};
  const problems = [];
  const log = opts.log || (() => {});
  let libs = libraries(root);
  if (opts.only) libs = libs.filter(l => l.folder === opts.only);
  if (!libs.length) problems.push('vendor/README.md names no tarball' + (opts.only ? ' for ' + opts.only : ''));
  for (const lib of libs) {
    let tgz;
    try { tgz = await fetch(lib.tarball); } catch (e) { problems.push(lib.folder + ': ' + e.message); continue; }
    const integrity = 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64');
    if (integrity !== lib.integrity) { problems.push(lib.folder + ': the tarball at ' + lib.tarball + ' has integrity ' + integrity + ', the README records ' + lib.integrity); continue; }
    let tar;
    try { tar = untar(zlib.gunzipSync(tgz)); } catch (e) { problems.push(lib.folder + ': the tarball could not be read: ' + e.message); continue; }
    if (!lib.files.length) problems.push(lib.folder + ': the README table names no file with its path in the tarball');
    for (const f of lib.files) {
      const inTar = tar.get(f.tar);
      const mine = fs.readFileSync(path.join(root, 'vendor', f.file));
      if (!inTar) problems.push(lib.folder + ': ' + f.tar + ' is not in the tarball');
      else if (!inTar.equals(mine)) problems.push(lib.folder + ': vendor/' + f.file + ' is not byte for byte ' + f.tar + ' of the tarball');
      else log('ok  vendor/' + f.file + ' = ' + lib.tarball.replace(/^.*\//, '') + ':' + f.tar);
    }
  }
  return problems;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const root = path.resolve(opt('--root') || path.join(__dirname, '..', '..'));
  verify(root, { only: opt('--only'), log: s => console.log(s) }).then(problems => {
    problems.forEach(p => console.error('FAIL ' + p));
    if (!problems.length) console.log('every vendored npm file is the published one');
    process.exitCode = problems.length ? 1 : 0;
  }, e => { console.error(e); process.exitCode = 1; });
}
module.exports = { verify, libraries, untar };
