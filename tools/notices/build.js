#!/usr/bin/env node
/* G13-3: THIRD_PARTY_NOTICES.md, generated.

     node tools/notices/build.js              write THIRD_PARTY_NOTICES.md at the repository root
     node tools/notices/build.js --check      exit 1 when that file is not what the sources say, or when a source has no row (the CI form)
     node tools/notices/build.js --root DIR   read (and write, or check) another tree: the mutation tests use a copy

   What it reads - the facts live where they were written down, and this file only gathers them:
     vendor/README.md          every `## section`: the files PPP serves itself (VexFlow, React, the fonts), where each came from, its sha256 and licence;
                               the licence file of each family. A file of vendor/ that README does not name, a folder with no section, a font file
                               whose family has no licence row: --check fails (a vendor folder without a row is the case G13-3 exists for).
     audio/piano/README.md     the Salamander attribution paragraph, verbatim (CC BY 3.0 asks for it) and the changes made.
     catalog/hymns/README.md   the hymn source, with catalog/hymns/index.json; catalog/method/index.json (every book: edition and licence);
     catalog/index.json        the seed library.
     the code the site serves  (static-allow.js decides which files, comments cut out): which libraries come from a CDN (jsDelivr, unpkg, esm.sh), which
                               Google Fonts families and which other files of third-party hosts; and EVERY https host any of it names must be one of the
                               hosts tools/notices/notices.json knows (what it is: a library host, fonts, data, a service, a link, a namespace). A package
                               with no licence row, a row for a package no longer named, a host nobody has classified: the check fails.
     requirements-*.txt, tools/home-worker/setup-*.cmd, package.json
                               every pinned Python package, every model a setup script downloads and every runtime dependency of the server must be
                               in a helper row of notices.json (its `ids`) or in its explicit omissions, with a reason.
     tools/notices/notices.json  the facts no README holds (G13 section E8): CDN licences, helper tools, hosts, the catalogue and demo and YouTube wording.
                               A licence that this repository states (Audiveris AGPL-3.0, Kong Apache-2.0, Demucs MIT, the SheetSage2 weights CC BY-NC
                               4.0) names the file that says it (`evidence`) and --check reads that file; any other tool says "see the project's own licence".

   Facts, not legal advice. Node only, no dependencies, reads no network. Line endings: sources are read with CRLF as LF, the output is LF, and the
   comparison ignores the difference, so a Windows checkout with autocrlf agrees with CI. */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const OUT = 'THIRD_PARTY_NOTICES.md';
const PAGE = 'Piano Coach App.dc.html';
const lf = s => String(s).replace(/\r\n?/g, '\n');
const read = (root, rel) => lf(fs.readFileSync(path.join(root, rel), 'utf8'));
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const plain = s => String(s == null ? '' : s).replace(/`/g, '').replace(/\s+/g, ' ').trim();
const normId = s => String(s).toLowerCase().replace(/_/g, '-');

/* ---------------------------------------------------------------- markdown readers */
function sectionsOf(md) {
  const out = [];
  let cur = null;
  lf(md).split('\n').forEach(line => {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) { cur = { heading: m[1], lines: [] }; out.push(cur); } else if (cur) cur.lines.push(line);
  });
  return out.map(s => ({ heading: s.heading, body: s.lines.join('\n') }));
}
function tablesOf(body) {
  const tables = [];
  let cur = null;
  body.split('\n').forEach(line => {
    if (/^\|/.test(line)) {
      const cells = line.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      if (!cur) { cur = { header: cells, rows: [], sep: false }; tables.push(cur); } else if (!cur.sep && cells.every(c => /^:?-{3,}:?$/.test(c))) cur.sep = true;
      else cur.rows.push(cells);
    } else cur = null;
  });
  return tables;
}
function paragraphStarting(body, prefix) {
  const paras = body.split(/\n\s*\n/);
  const p = paras.find(x => x.trim().indexOf(prefix) === 0);
  return p ? p.trim().replace(/\s*\n\s*/g, ' ') : '';
}
const codeSpans = md => Array.from(lf(md).matchAll(/`([^`\n]+)`/g)).map(m => m[1].replace(/^\.\//, ''));

function copyrightLine(root, rel) {
  const lines = read(root, rel).split('\n').map(l => l.trim());
  /* the template line of the Apache appendix ("Copyright [yyyy] [name of copyright owner]") is not a notice */
  return (lines.find(l => /^Copyright\b/i.test(l) && !/\[yyyy\]/i.test(l)) || '').replace(/,$/, '');
}
function walkFiles(root, rel) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) out.push(...walkFiles(root, r)); else out.push(r);
  }
  return out;
}

/* ---------------------------------------------------------------- vendor/ */
function readVendor(root, problems) {
  const readmeRel = 'vendor/README.md';
  if (!exists(root, readmeRel)) { problems.push('vendor/README.md is missing'); return { sections: [], families: [] }; }
  const md = read(root, readmeRel);
  const secs = sectionsOf(md);
  const named = new Set(codeSpans(md));
  secs.forEach(s => { named.add(s.heading.replace(/\/$/, '')); named.add(s.heading); });

  /* every file of vendor/ is named by README (a licence file, a font, a library) */
  const files = walkFiles(root, 'vendor').map(f => f.slice('vendor/'.length)).filter(f => f !== 'README.md' && f !== '.gitattributes');
  files.forEach(f => {
    if (!named.has(f) && !named.has('./' + f)) problems.push('vendor/' + f + ' has no row in vendor/README.md (name it in its section: file, where it came from, its licence)');
  });
  /* every top-level entry has a section of its own */
  const tops = fs.readdirSync(path.join(root, 'vendor')).filter(n => n !== 'README.md' && n !== '.gitattributes' && !/^LICENSE/.test(n));
  tops.forEach(n => {
    if (!secs.some(s => s.heading.replace(/\/$/, '') === n)) problems.push('vendor/' + n + ' has no "## ' + n + '" section in vendor/README.md');
  });
  /* a licence file at the top of vendor/ must be named too (VexFlow's own fonts): done by the file rule above */

  const sections = [];
  const families = [];
  secs.forEach(s => {
    const name = s.heading.replace(/\/$/, '');
    if (!exists(root, 'vendor/' + name)) { problems.push('vendor/README.md has a section "' + s.heading + '" but vendor/' + name + ' is not there'); return; }
    const tables = tablesOf(s.body);
    const kv = tables.find(t => t.header.every(c => c === ''));
    const filesTable = tables.find(t => t.header[0] === 'File');
    const famTable = tables.find(t => t.header[0] === 'Family');
    const buildFonts = tables.find(t => /^Font\b/.test(t.header[0]));
    const sec = { name: name, heading: s.heading };
    if (kv) {
      const map = {};
      kv.rows.forEach(r => { map[plain(r[0])] = r[1] || ''; });
      sec.kind = 'library';
      sec.what = plain(map.What || '');
      sec.title = (/^([^,]+),/.exec(sec.what) || [null, name])[1].trim();
      sec.from = plain(map.From || '');
      sec.sha256 = plain(map.sha256 || '');
      sec.size = plain(map.Size || '');
      sec.licence = plain(map.Licence || '');
      sec.licenceFiles = Array.from(String(map.Licence || '').matchAll(/`([^`]+\.txt)`/g)).map(m => m[1]);
      sec.buildFonts = buildFonts ? buildFonts.rows.map(r => ({ font: plain(r[0]), licence: plain(r[1]), notice: plain(r[2]) })) : [];
      sec.file = name;
    } else if (filesTable && filesTable.header[1] === 'From') {
      const p = paragraphStarting(s.body, 'Licence:');
      sec.kind = 'package';
      sec.licence = plain(p.replace(/^Licence:\s*/, ''));
      sec.licenceFiles = Array.from(p.matchAll(/`([^`]+\.txt)`/g)).map(m => m[1]);
      sec.files = filesTable.rows.map(r => ({ file: plain(r[0]), from: plain(r[1]), size: plain(r[2]), sha256: plain(r[3]) }));
      /* the title: the words of the first paragraph before its first comma or bracket ("React and ReactDOM 18.3.1, the UMD ...", "pdf.js 3.11.174 (npm ...), ...") */
      const first = s.body.trim().split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ');
      sec.title = plain((/^(.+?)(?:\s\(|,\s)/.exec(first) || [null, name])[1]);
      /* optional paragraphs (G13-8): what it is used for, and the copyright notice as the files carry it (an Apache LICENSE file holds only the template line) */
      sec.use = plain(paragraphStarting(s.body, 'Used for:').replace(/^Used for:\s*/, ''));
      sec.copyright = plain(paragraphStarting(s.body, 'Copyright:').replace(/^Copyright:\s*/, ''));
      if (!/^Licence:/.test(p)) problems.push('vendor/README.md section "' + s.heading + '" has no "Licence:" paragraph');
    } else if (filesTable && /^Family/.test(filesTable.header[1] || '') && famTable) {
      sec.kind = 'fonts';
      sec.files = filesTable.rows.map(r => ({ file: plain(r[0]), family: plain(r[1]), from: plain(r[2]), size: plain(r[3]), sha256: plain(r[4]) }));
      sec.families = famTable.rows.map(r => ({ family: plain(r[0]), copyright: plain(r[1]), file: plain(r[2]) }));
      sec.licence = plain((/\((SIL Open Font License 1\.1)\)/.exec(s.body) || [null, 'SIL Open Font License 1.1'])[1]);
      /* each font file's family has a licence row, and that licence file is there */
      sec.files.forEach(f => {
        const stem = f.file.replace(/^fonts\//, '').replace(/-v\d+.*$/, '');
        const row = sec.families.find(x => x.file === 'fonts/LICENSE-' + stem + '-OFL.txt');
        if (!row) problems.push('vendor/' + f.file + ': the family "' + stem + '" has no licence row (fonts/LICENSE-' + stem + '-OFL.txt) in vendor/README.md');
        else if (!exists(root, 'vendor/' + row.file)) problems.push('vendor/' + row.file + ' is named by vendor/README.md but is not there');
      });
      sec.families.forEach(x => { if (!exists(root, 'vendor/' + x.file)) problems.push('vendor/' + x.file + ' is named by vendor/README.md but is not there'); });
      sec.families.forEach(x => families.push(x));
    } else {
      problems.push('vendor/README.md section "' + s.heading + '" has a shape tools/notices/build.js does not read (a table of files with their source, and a licence): extend the reader or the section');
      return;
    }
    (sec.licenceFiles || []).forEach(f => {
      const rel = 'vendor/' + f;
      if (!exists(root, rel)) problems.push(rel + ' is named as a licence in vendor/README.md but is not there');
    });
    sections.push(sec);
  });
  return { sections: sections, families: families };
}

/* ---------------------------------------------------------------- the code the site serves */
/* directories that are not the page's scripts (third-party libraries have their own README; tests, tools, docs and data are not served) */
const NOT_SCANNED = new Set('vendor tests tools docs review data assets audio catalog samples i18n node_modules'.split(' '));
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w'"`\\])\/\/[^\n]*/g, '');
}
/* [{ rel, text }]: the .js and .html files static-allow.js hands out (the page, support.js, every module it loads), comments cut out */
function servedCode(root) {
  let allow = null;
  try { allow = require(path.join(root, 'static-allow.js')); } catch (e) { allow = null; }
  const files = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true })) {
      if (e.name.startsWith('.') || NOT_SCANNED.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (/\.(?:js|html)$/.test(e.name) && (allow ? allow.isServed(r) : r === PAGE || r === 'support.js')) files.push(r);
    }
  })('');
  return files.sort().map(rel => ({ rel: rel, text: stripComments(read(root, rel)) }));
}

/* ---------------------------------------------------------------- the page's CDN list and hosts */
function readCdn(root, registry, vendor, code, problems) {
  const text = code.map(f => f.text).join('\n');
  /* https://cdn.jsdelivr.net/npm/<pkg>@<version>/... ; unpkg.com/<pkg>@<version>/... ; esm.sh/<pkg>@<version> */
  const rx = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com|esm\.sh)\/((?:@[\w.-]+\/)?[\w.-]+)@([\w.-]+)/g;
  const found = new Map();                 // pkg -> Set(version)
  for (const m of text.matchAll(rx)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add(m[2]);
  }
  /* any other path on those hosts (unpinned, or a GitHub path) is a library with no version to put a licence row against */
  for (const m of text.matchAll(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)\/[^\s'"`)<>]*/g)) {
    const u = m[0];
    const ok = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[\w.-]+\/)?[\w.-]+@[\w.-]+/.test(u) || /^https:\/\/(?:unpkg\.com|esm\.sh)\/(?:@[\w.-]+\/)?[\w.-]+@[\w.-]+/.test(u);
    if (!ok) problems.push('the page loads ' + u + ' from ' + m[1] + ': a library there must be named with its version (<package>@<version>) so that it has a licence row');
  }
  const vendorNames = new Set(vendor.sections.map(s => s.name));
  const packages = [];
  const pkgs = registry.cdn.packages;
  const fallback = registry.cdn.fallbackOf;
  Array.from(found.keys()).sort().forEach(pkg => {
    if (fallback[pkg]) {
      /* one folder, or several (TensorFlow.js has two versions) */
      [].concat(fallback[pkg]).forEach(f => {
        if (!vendorNames.has(f)) problems.push('the page names ' + pkg + ' at a CDN as a fallback of vendor/' + f + ', which is not in vendor/');
      });
      return;
    }
    if (!pkgs[pkg]) { problems.push('the page loads ' + pkg + ' from a CDN and tools/notices/notices.json has no licence row for it (cdn.packages)'); return; }
    packages.push(Object.assign({ pkg: pkg, versions: Array.from(found.get(pkg)).sort() }, pkgs[pkg]));
  });
  Object.keys(pkgs).forEach(pkg => {
    if (!found.has(pkg)) problems.push('tools/notices/notices.json lists ' + pkg + ' as loaded from a CDN, but the page no longer names it (vendored or removed): take its row out');
  });
  /* the Google Fonts stylesheet(s): the families asked for */
  const fam = new Set();
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2\?([^'"\s]+)/g)) {
    for (const f of m[1].matchAll(/family=([^&:]+)/g)) fam.add(decodeURIComponent(f[1].replace(/\+/g, ' ')));
  }
  const vendoredFamilies = new Set();
  vendor.families.forEach(f => vendoredFamilies.add(f.family));
  const googleFamilies = Array.from(fam).filter(f => !vendoredFamilies.has(f)).sort();
  /* the other hosts of data (the checkpoint) */
  const other = [];
  registry.cdn.other.forEach(o => {
    if (text.indexOf(o.key) < 0) problems.push('tools/notices/notices.json lists ' + o.key + ' but the page no longer names it: take its row out');
    else other.push(o);
  });
  for (const m of text.matchAll(/https:\/\/storage\.googleapis\.com\/[\w./-]+/g)) {
    if (!registry.cdn.other.some(o => m[0].slice('https://'.length).indexOf(o.key) === 0)) problems.push('the page names ' + m[0] + ' and tools/notices/notices.json has no row for it (cdn.other)');
  }
  /* the vendored libraries the page also names at a CDN, only as the way back: by the title of their vendor/ section */
  const wayBack = [];
  Object.keys(fallback).forEach(pkg => {
    if (pkg.charAt(0) === '_' || !found.has(pkg)) return;
    [].concat(fallback[pkg]).forEach(f => {
      const sec = vendor.sections.find(x => x.name === f);
      if (sec && wayBack.indexOf(sec.title) < 0) wayBack.push(sec.title);
    });
  });
  return { packages: packages, googleFamilies: googleFamilies, other: other, wayBack: wayBack };
}

/* Every host the served code names is one tools/notices/notices.json has classified. A library, a font or a data file from a host nobody has looked at (a cdnjs script,
   a raw.githubusercontent.com file) is exactly what a licence list is for. Returns the services the page contacts, for the notices. */
function readHosts(registry, code, problems) {
  const h = registry.hosts || {};
  const role = new Map();
  ['npm', 'fonts', 'storage', 'local', 'namespace', 'link'].forEach(r => (h[r] || []).forEach(x => role.set(x.toLowerCase(), r)));
  Object.keys(h.service || {}).forEach(x => role.set(x.toLowerCase(), 'service'));
  const seen = new Map();                   // host -> [files]
  code.forEach(f => {
    for (const m of f.text.matchAll(/\bhttps?:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)/g)) {
      const host = m[1].toLowerCase();
      if (!seen.has(host)) seen.set(host, []);
      if (seen.get(host).indexOf(f.rel) < 0) seen.get(host).push(f.rel);
    }
  });
  Array.from(seen.keys()).sort().forEach(host => {
    if (!role.has(host)) {
      problems.push('the site\'s code names https://' + host + ' (' + seen.get(host).slice(0, 2).join(', ') + ') and tools/notices/notices.json does not know that host: say what it is under hosts (npm, fonts, storage, service, link or namespace), and if it loads code, fonts or data give that a licence row');
    }
  });
  /* a host that carries a row of the notices (a library host, a service) must still be named by the code */
  role.forEach((r, host) => {
    if ((r === 'npm' || r === 'fonts' || r === 'storage' || r === 'service') && !seen.has(host)) {
      problems.push('tools/notices/notices.json lists ' + host + ' under hosts (' + r + ') but no served file names it any more: take it out');
    }
  });
  return Object.keys(h.service || {}).filter(host => seen.has(host.toLowerCase())).sort().map(host => ({ host: host, note: h.service[host] }));
}

/* ---------------------------------------------------------------- tools, models and packages */
/* The Python packages pinned in requirements-*.txt, the models the setup scripts download and the runtime dependencies of package.json: each is in a helper row (ids) or an omission. */
const NOT_A_MODEL = new Set(['tools', 'and', 'or', 'n', 'y', 'http', 'https', 'a', 'b']);
function readHelpers(root, registry, problems) {
  const rows = registry.helpers.rows;
  const covered = new Map();
  rows.forEach(r => (r.ids || []).forEach(id => covered.set(normId(id), r.name)));
  const omitted = new Map();
  (registry.helpers.omissions || []).forEach(o => omitted.set(normId(o.id), o.reason));
  /* the statements a row relies on are still where it says */
  rows.forEach(r => {
    if (!r.evidence) return;
    if (!exists(root, r.evidence.file)) problems.push('helper row "' + r.name + '": ' + r.evidence.file + ' (which states its licence) is not there');
    else if (!new RegExp(r.evidence.pattern).test(read(root, r.evidence.file))) {
      problems.push('helper row "' + r.name + '": ' + r.evidence.file + ' no longer says ' + JSON.stringify(r.evidence.pattern) + ' - the licence of that row is not stated there any more');
    }
  });
  const need = [];                          // { id, from }
  fs.readdirSync(root).filter(n => /^requirements[\w.-]*\.txt$/.test(n)).sort().forEach(n => {
    read(root, n).split('\n').forEach(line => {
      if (/^\s*#/.test(line)) return;
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:==|>=|<=|~=|!=|<|>)/.exec(line);
      if (m) need.push({ id: m[1], from: n + ' (a pinned requirement)' });
    });
  });
  const setupDir = 'tools/home-worker';
  if (exists(root, setupDir)) {
    fs.readdirSync(path.join(root, setupDir)).filter(n => /^setup-[\w.-]+\.cmd$/.test(n)).sort().forEach(n => {
      const t = read(root, setupDir + '/' + n);
      const ids = new Set();
      for (const m of t.matchAll(/repo_id\s*=\s*'([^']+)'/g)) ids.add(m[1]);
      for (const m of t.matchAll(/(?<![\w\/.:\\-])([a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])(?![\w\/\\])/g)) {
        if (!NOT_A_MODEL.has(m[1].split('/')[0])) ids.add(m[1]);
      }
      ids.forEach(id => need.push({ id: id, from: setupDir + '/' + n + ' (a model it downloads)' }));
    });
  }
  if (exists(root, 'package.json')) {
    const pkg = JSON.parse(read(root, 'package.json'));
    Object.keys(pkg.dependencies || {}).forEach(id => need.push({ id: id, from: 'package.json (a runtime dependency)' }));
  }
  const seen = new Set();
  need.forEach(n => {
    const k = normId(n.id);
    if (seen.has(k)) return;
    seen.add(k);
    if (!covered.has(k) && !omitted.has(k)) {
      problems.push(n.from.split(' (')[0] + ' names ' + n.id + ' and tools/notices/notices.json has no helper row for it (helpers.rows ids) or omission (helpers.omissions)');
    }
  });
  return rows;
}

/* ---------------------------------------------------------------- the catalogues */
function readCatalogue(root, registry, problems) {
  const out = {};
  const readmeRel = 'catalog/hymns/README.md';
  if (!exists(root, readmeRel)) problems.push(readmeRel + ' is missing');
  else {
    const body = read(root, readmeRel).split('\n').slice(1).join('\n').trim();
    out.hymnsParagraph = body.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
    const m = /\[Open Hymnal Project\]\(([^)]+)\)\s*\(([^)]+)\)/.exec(out.hymnsParagraph);
    if (!m) problems.push(readmeRel + ': its first paragraph no longer names the Open Hymnal Project, its link and its edition in brackets');
    out.hymnUrl = m ? m[1] : 'http://openhymnal.org/';
    out.hymnEdition = m ? m[2] : '';
  }
  const hymnsIndex = JSON.parse(read(root, 'catalog/hymns/index.json'));
  out.hymnCount = (hymnsIndex.hymns || []).length;
  out.hymnStatements = Array.from(new Set((hymnsIndex.hymns || []).map(x => plain(x.license)).filter(Boolean))).sort();
  const method = JSON.parse(read(root, 'catalog/method/index.json'));
  out.methodLicense = plain(method.license || '');
  const review = registry.catalogue.underReview || {};
  out.books = (method.books || []).map(b => {
    const code = b.license || b.licence;
    const licence = registry.catalogue.licenceNames[code];
    if (!licence) problems.push('catalog/method/index.json: book ' + b.id + ' has the licence code "' + code + '", which tools/notices/notices.json does not name (catalogue.licenceNames)');
    if (!b.edition) problems.push('catalog/method/index.json: book ' + b.id + ' has no edition line');
    const count = (b.pieces || []).length || b.count || 0;
    let cell = licence || plain(code);
    const r = review[b.id];
    if (r) cell += ' per the dataset listing; the piece-level statement of ' + (r === 'all' ? 'all ' + count + ' pieces' : 'nos. ' + r.join(', ')) + ' is under review';
    return { id: b.id, title: plain(b.title), composer: plain(b.composer), count: count, edition: plain(b.edition), licence: cell };
  });
  Object.keys(review).forEach(id => { if (!(method.books || []).some(b => b.id === id)) problems.push('tools/notices/notices.json catalogue.underReview names book ' + id + ', which catalog/method/index.json does not have'); });
  const index = JSON.parse(read(root, 'catalog/index.json'));
  out.indexLicense = plain(index.license || '');
  out.indexed = (index.scores || []).map(s => ({ title: plain(s.title), composer: plain(s.composer), licence: plain(s.license) }));
  const seeds = JSON.parse(read(root, 'catalog/shared-seeds.json'));
  out.seedLicense = plain(seeds.license || '');
  out.seeds = (seeds.seeds || []).map(s => ({ title: plain(s.title), composer: plain(s.composer), genre: plain(s.genre), licence: plain(s.license) }));
  if (!out.seeds.length) problems.push('catalog/shared-seeds.json lists no seed');
  out.seeds.forEach(s => { if (!s.licence) problems.push('catalog/shared-seeds.json: "' + s.title + '" has no licence'); });
  return out;
}

/* ---------------------------------------------------------------- audio/piano */
function readPiano(root, problems) {
  const rel = 'audio/piano/README.md';
  if (!exists(root, rel)) { problems.push(rel + ' is missing'); return null; }
  const md = read(root, rel);
  const paras = md.split(/\n\s*\n/).map(p => p.trim().replace(/\s*\n\s*/g, ' ')).filter(Boolean);
  const attribution = paras.find(p => /Salamander Grand Piano/.test(p) && /CC BY/.test(p));
  const changed = paras.find(p => /^Changed here:/.test(p));
  if (!attribution) problems.push(rel + ': the Salamander attribution paragraph (title, author, "CC BY 3.0") is not there');
  else {
    if (!/Alexander Holm/.test(attribution)) problems.push(rel + ': the attribution does not name its author (Alexander Holm)');
    if (!/creativecommons\.org\/licenses\/by\/3\.0/.test(attribution)) problems.push(rel + ': the attribution does not link the CC BY 3.0 licence');
  }
  if (!changed) problems.push(rel + ': the "Changed here:" paragraph (CC BY asks that changes be said) is not there');
  return { attribution: attribution || '', changed: changed || '' };
}

/* ---------------------------------------------------------------- the document */
/* a list that reads as plain text (the file is served as text/plain): "- first cell - Header: value; Header: value" */
function list(header, rows) {
  return rows.map(r => '- ' + String(r[0]) + r.slice(1).map((c, i) => (i === 0 ? ' - ' : '; ') + header[i + 1] + ': ' + String(c).replace(/\n/g, ' ')).join('')).join('\n');
}

function build(root) {
  root = root || DEFAULT_ROOT;
  const problems = [];
  const registry = JSON.parse(read(root, 'tools/notices/notices.json'));
  const piano = readPiano(root, problems);
  const vendor = readVendor(root, problems);
  const code = servedCode(root);
  const cdn = readCdn(root, registry, vendor, code, problems);
  const services = readHosts(registry, code, problems);
  const helpers = readHelpers(root, registry, problems);
  const cat = readCatalogue(root, registry, problems);
  const L = [];
  const p = (...s) => s.forEach(x => L.push(x));

  p('# Third-party notices', '',
    'PPP - Piano Practice Partner uses the work of others. This file says what, who made it, where it comes from and under what licence. It is generated by `node tools/notices/build.js` from the README files of `vendor/`, `audio/piano/` and `catalog/`, from the libraries the page loads and from `tools/notices/notices.json`; do not edit it by hand (`node tools/notices/build.js --check` fails when it is out of date, or when something PPP serves or runs has no row here).',
    '',
    'These are statements of fact about the files of this project, not legal advice. In the app the same information is in Settings > About & licences.', '');

  /* 1. the piano recordings */
  p('## Piano sounds (attribution required)', '');
  if (piano) {
    p('> ' + piano.attribution, '', piano.changed, '',
      'The files are `audio/piano/*.mp3`. Licence: Creative Commons Attribution 3.0 (CC BY 3.0), https://creativecommons.org/licenses/by/3.0/ . It allows use, sharing and adaptation, and asks for the credit above, a link to the licence and a note of the changes made.', '');
  }

  /* 2. what PPP serves itself */
  p('## Code and fonts PPP serves itself (`vendor/`)', '',
    'Each file is kept byte for byte as its authors published it (hashes in `vendor/README.md`). The licence text of each travels with it in `vendor/`.', '');
  vendor.sections.forEach(s => {
    if (s.kind === 'library') {
      p('### ' + s.title + ' - ' + (s.licence.split(',')[0] || ''), '',
        '- What: ' + s.what.replace(/^[^,]+,\s*/, ''),
        '- File: `vendor/' + s.file + '` (' + s.size + ', sha256 `' + s.sha256 + '`)',
        '- From: ' + s.from,
        '- Licence: ' + s.licence,
        '- Copyright: ' + (s.licenceFiles.map(f => copyrightLine(root, 'vendor/' + f)).filter(Boolean)[0] || ''), '');
      if (s.buildFonts.length) {
        p('Music fonts whose outlines are inside that file:', '',
          list(['Font', 'Licence', 'Notice'], s.buildFonts.map(f => [plain(f.font), plain(f.licence), plain(f.notice)])), '');
      }
    } else if (s.kind === 'package') {
      p('### ' + s.title + ' - ' + (s.licence.split(/[\s,]/)[0] || ''), '',
        list(['File', 'From', 'sha256'], s.files.map(f => ['`vendor/' + f.file + '`', plain(f.from), '`' + f.sha256 + '`'])), '');
      if (s.use) p('- Used for: ' + s.use);
      p('- Licence: ' + s.licence,
        '- Copyright: ' + (s.copyright || s.licenceFiles.map(f => copyrightLine(root, 'vendor/' + f)).filter(Boolean)[0] || ''), '');
    } else if (s.kind === 'fonts') {
      p('### Fonts - ' + s.licence + ' (OFL-1.1)', '',
        'The woff2 files are Google Fonts\' own, unmodified. The licence permits redistribution with its notice, which is here.', '',
        list(['Family', 'Copyright', 'Licence file'], s.families.map(f => [plain(f.family), plain(f.copyright), '`vendor/' + f.file + '`'])), '',
        list(['File', 'Family and subset', 'From'], s.files.map(f => ['`vendor/' + f.file + '`', plain(f.family), plain(f.from)])), '');
    }
  });

  /* 3. CDN */
  p('## Libraries loaded from another site, not served by PPP', '',
    'These are fetched by your browser from the host named, only when the feature that needs them is used.', '');
  if (cdn.packages.length) {
    p(list(['Library', 'Versions', 'Licence', 'Used for'],
      cdn.packages.map(c => [plain(c.name) + ' (`' + c.pkg + '`)', c.versions.join(', '), plain(c.licence), plain(c.use)])), '');
  }
  if (cdn.googleFamilies.length) {
    p('Fonts from Google Fonts for Korean, Japanese and Chinese text: ' + cdn.googleFamilies.join(', ') + '. Licence: ' + registry.cdn.fonts.licence + ' (OFL-1.1), fetched from ' + registry.cdn.fonts.host + ' after the page has loaded.', '');
  }
  cdn.other.forEach(o => p('- ' + o.name + ' - ' + o.host + ': ' + o.use + '. Licence: ' + o.licence + '.'));
  if (cdn.other.length) p('');
  if (cdn.wayBack.length) {
    p(cdn.wayBack.join('; ') + ' - named at unpkg.com, cdn.jsdelivr.net or esm.sh as well, only as the way back (`?cdn=1`, or when PPP\'s own copy cannot be fetched); PPP serves them itself (above).', '');
  }
  if (services.length) {
    p('Other sites the page itself contacts (their own terms apply; no licence of theirs is carried here):', '');
    services.forEach(s => p('- ' + s.host + ': ' + s.note));
    p('');
  }

  /* 4. PPP's own */
  p('## PPP\'s own files', '');
  registry.own.forEach(o => p('- ' + o.text));
  p('');

  /* 5. the catalogues */
  p('## Scores in the catalogues', '');
  if (cat.hymnsParagraph) {
    p('### Hymns (' + cat.hymnCount + ')', '',
      cat.hymnCount + ' hymn tunes from the Open Hymnal Project (' + cat.hymnUrl + '; ' + cat.hymnEdition + '), reduced to two-staff piano MusicXML. The Open Hymnal publishes its hymns as public domain or under free licences, so the licence is that of each tune; this repository records one statement per file in `catalog/hymns/index.json` and has not checked them tune by tune: ' + cat.hymnStatements.map(x => '"' + x + '"').join('; ') + '. The Korean titles are common names; these are not official hymnal engravings and carry no lyrics.', '');
  }
  p('### Method books', '', cat.methodLicense, '',
    list(['Book', 'Composer', 'Pieces', 'Edition', 'Licence'],
      cat.books.map(b => [plain(b.title), plain(b.composer), b.count, plain(b.edition), plain(b.licence)])), '');
  p('### Public-domain scores a recording can be matched to', '', cat.indexLicense, '',
    list(['Piece', 'Composer', 'Licence'], cat.indexed.map(s => [plain(s.title), plain(s.composer), plain(s.licence)])), '');
  p('### Seed library of Shared Scores', '', cat.seedLicense, '',
    list(['Piece', 'Composer', 'Genre', 'Licence'], cat.seeds.map(s => [plain(s.title), plain(s.composer), plain(s.genre), plain(s.licence)])), '');
  p('### Typesets under review', '', registry.catalogue.underReviewText, '');

  /* 6. the demo (its TODO is in tools/notices/notices.json only: it is not for the people who read this) */
  p('### The built-in demo score', '', registry.demo.text, '');

  /* 7. YouTube */
  p('## YouTube links', '', registry.youtube.text, '');

  /* 8. helper tools */
  p('## Tools, models and packages that run on your own computer or on the server', '',
    'These are not part of the page. A licence is given where this project states it (and which file says so); for the others see the project\'s own licence.', '',
    list(['Tool', 'Licence', 'Where it runs'], helpers.map(r => [plain(r.name), plain(r.licence) + (r.evidence ? ' (stated in ' + r.evidence.file + ')' : ''), plain(r.where)])), '');
  if ((registry.helpers.omissions || []).length) {
    p('Not listed above:', '');
    registry.helpers.omissions.forEach(o => p('- ' + o.id + ': ' + o.reason));
    p('');
  }

  const text = L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n';
  return { text: text, problems: problems };
}

function main(argv) {
  const args = argv.slice(2);
  const rootIx = args.indexOf('--root');
  const root = rootIx >= 0 ? path.resolve(args[rootIx + 1]) : (process.env.PPP_NOTICES_ROOT ? path.resolve(process.env.PPP_NOTICES_ROOT) : DEFAULT_ROOT);
  const check = args.includes('--check');
  let result;
  try { result = build(root); } catch (e) {
    console.error('notices: the sources could not be read: ' + e.message);
    return 1;
  }
  const outFile = path.join(root, OUT);
  if (check) {
    const problems = result.problems.slice();
    let have = null;
    try { have = lf(fs.readFileSync(outFile, 'utf8')); } catch (e) { have = null; }
    if (have == null) problems.push(OUT + ' is missing: run node tools/notices/build.js');
    else if (have !== result.text) {
      const a = have.split('\n'), b = result.text.split('\n');
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      problems.push(OUT + ' is not what the sources say (first difference at line ' + (i + 1) + '): run node tools/notices/build.js and commit it');
    }
    if (problems.length) {
      problems.forEach(x => console.error('notices: ' + x));
      return 1;
    }
    console.log('notices: ' + OUT + ' is up to date; every file of vendor/, every library and host the site names, every pinned package, model and runtime dependency has a row');
    return 0;
  }
  if (result.problems.length) {
    result.problems.forEach(x => console.error('notices: ' + x));
    return 1;
  }
  fs.writeFileSync(outFile, result.text);
  console.log('notices: wrote ' + OUT + ' (' + result.text.split('\n').length + ' lines)');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { build, main, sectionsOf, tablesOf };
