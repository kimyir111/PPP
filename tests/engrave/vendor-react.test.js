/* G13-1 (docs/GOALS/G13_PRODUCTIZATION.md section 4 G13-D2/D3, section 6 row 2): React 18.3.1 is served by PPP itself from vendor/react-18.3.1/.

   The proof that the vendored files are the published ones is the proof support.js already carries: the sha384 of each file equals the SRI pin
   in support.js (REACT_SRI / REACT_DOM_SRI), which the browser checks when it loads the same files from unpkg. Then: nothing converted the bytes,
   the licences travel with them, the page loads them before support.js with a ?h= that the static server answers as immutable (server.js
   engineFile: the first 12 hex of the sha256, CRLF read as LF), and the PPP.cdn decision in the page head (the old unpkg path) is exactly
   what the document says. No DOM, no network. The browser side (offline, the DOM with and without ?cdn=1) is tests/vendor-react-app.test.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(REPO, rel));
const support = read('support.js').toString('utf8');
const page = read('Piano Coach App.dc.html').toString('utf8').replace(/\r\n/g, '\n');
const pin = name => { const m = new RegExp('var ' + name + ' = "([^"]+)";').exec(support); assert.ok(m, 'support.js has ' + name); return m[1]; };
const sri = buf => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
const h12 = buf => crypto.createHash('sha256').update(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex').slice(0, 12);

const FILES = [
  { name: 'React', url: pin('REACT_URL'), sri: pin('REACT_SRI') },
  { name: 'ReactDOM', url: pin('REACT_DOM_URL'), sri: pin('REACT_DOM_SRI') }
];
FILES.forEach(f => {
  const m = /^https:\/\/unpkg\.com\/(react(?:-dom)?)@(\d+\.\d+\.\d+)\/umd\/(react(?:-dom)?\.production\.min\.js)$/.exec(f.url);
  assert.ok(m, f.name + ' URL in support.js has the expected form: ' + f.url);
  f.pkg = m[1]; f.version = m[2]; f.base = m[3];
  f.rel = 'vendor/react-' + f.version + '/' + f.base;
});

test('the vendored React and ReactDOM are the published bytes: the sha384 of each file is the SRI pin in support.js', () => {
  assert.equal(FILES[0].version, FILES[1].version, 'React and ReactDOM are the same version');
  FILES.forEach(f => {
    assert.ok(fs.existsSync(path.join(REPO, f.rel)), f.rel + ' exists (the folder name is the version support.js pins; a version bump there moves the folder)');
    assert.equal(sri(read(f.rel)), f.sri, f.name + ': ' + f.rel + ' is not what ' + f.url + ' serves (support.js REACT_SRI / REACT_DOM_SRI)');
  });
});

test('the bytes were not touched on the way: no carriage return, git keeps them as they are, the banner is the package\'s', () => {
  FILES.forEach(f => {
    const buf = read(f.rel);
    assert.equal(buf.indexOf(13), -1, f.rel + ' has no carriage return: no line-ending conversion touched it');
    assert.match(buf.slice(0, 200).toString('latin1'), new RegExp('@license React\\n \\* ' + f.base.replace(/\./g, '\\.') + '\\n'), f.rel + ' starts with the package\'s own licence banner');
  });
  assert.match(read('vendor/.gitattributes').toString('utf8'), /^\* -text$/m, 'vendor/.gitattributes turns line-ending conversion off for everything under vendor/');
});

test('the MIT licence travels with each file, and vendor/README.md says which bytes these are', () => {
  const dir = 'vendor/react-' + FILES[0].version + '/';
  [['LICENSE-react.txt', 'react'], ['LICENSE-react-dom.txt', 'react-dom']].forEach(([f, pkg]) => {
    const t = read(dir + f).toString('utf8');
    assert.match(t, /^MIT License\n\nCopyright \(c\) Facebook, Inc\. and its affiliates\.\n/, pkg + ' licence is the package\'s own LICENSE');
    assert.match(t, /Permission is hereby granted, free of charge[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/, pkg + ' licence carries the full MIT text');
  });
  const readme = read('vendor/README.md').toString('utf8');
  FILES.forEach(f => {
    const buf = read(f.rel);
    assert.ok(readme.includes('react-' + f.version + '/' + f.base), 'README names ' + f.rel);
    assert.ok(readme.includes(f.sri), 'README carries the SRI of ' + f.rel);
    assert.ok(readme.includes(crypto.createHash('sha256').update(buf).digest('hex')), 'README carries the sha256 of ' + f.rel);
    assert.ok(readme.includes(String(buf.length)) || readme.includes(buf.length.toLocaleString('en-US')), 'README carries the size of ' + f.rel);
  });
});

test('the page loads React then ReactDOM before support.js, by content hash (so server.js answers them immutable)', () => {
  const tags = [...page.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const at = n => { const i = tags.findIndex(t => t.split('?')[0] === n); assert.ok(i >= 0, n + ' is a script of the page'); return i; };
  const iReact = at(FILES[0].rel), iDom = at(FILES[1].rel), iSupport = at('support.js');
  assert.ok(iReact < iDom && iDom < iSupport, 'order: react, react-dom, support.js');
  [FILES[0], FILES[1]].forEach(f => {
    const t = tags.find(x => x.split('?')[0] === f.rel);
    assert.equal(t, f.rel + '?h=' + h12(read(f.rel)), f.rel + ': the ?h= is the file\'s own (12 hex of its sha256); a stale one only costs the cache, but this test wants it right');
  });
  /* the decision comes first, and the "drop it again" script sits between the vendored files and support.js */
  const decide = page.indexOf('window.PPP_CDN = (function'), drop = page.indexOf('<script>if (window.PPP_CDN)');
  assert.ok(decide > 0 && decide < page.indexOf('<script src="./' + FILES[0].rel), 'PPP_CDN is decided before the vendored files');
  assert.ok(drop > page.indexOf('<script src="./' + FILES[1].rel) && drop < page.indexOf('<script src="./support.js"'), 'the cdn drop sits after ReactDOM and before support.js');
  assert.equal(page.split('window.PPP_CDN = (function').length, 2, 'decided once');
});

/* the two inline scripts of the head, run in a bare context with the page globals they touch */
const decideSrc = (() => { const a = page.indexOf('window.PPP_CDN = (function'); return page.slice(a, page.indexOf('</script>', a)); })();
const dropSrc = (() => { const a = page.indexOf('<script>if (window.PPP_CDN)') + '<script>'.length; return page.slice(a, page.indexOf('</script>', a)); })();
function decide(opts) {
  const o = opts || {};
  const ctx = {
    localStorage: { getItem: k => { if (o.storageThrows) throw new Error('no storage'); return k === 'ppp.cdn' && o.stored !== undefined ? o.stored : null; } },
    location: { get search() { if (o.locationThrows) throw new Error('no address'); return o.search || ''; } },
    URLSearchParams: URLSearchParams
  };
  ctx.window = ctx;
  vm.runInNewContext(decideSrc, ctx);
  return ctx.window.PPP_CDN;
}
function dropped(cdn) {
  const ctx = { PPP_CDN: cdn, React: { r: 1 }, ReactDOM: { d: 1 } };
  ctx.window = ctx;
  vm.runInNewContext(dropSrc, ctx);
  return { React: ctx.React, ReactDOM: ctx.ReactDOM };
}

test('PPP.cdn: the default is vendored; ?cdn=1 or a stored 1 is the old unpkg path; ?cdn=0 beats a stored 1; any other value is no choice', () => {
  assert.equal(decide(), false, 'no address, nothing stored: vendored');
  assert.equal(decide({ search: '?cdn=1' }), true, '?cdn=1');
  assert.equal(decide({ search: '?x=2&cdn=1&y=3' }), true, '?cdn=1 among other parameters');
  assert.equal(decide({ stored: '1' }), true, 'a stored 1');
  assert.equal(decide({ stored: '1', search: '?cdn=0' }), false, '?cdn=0: vendored for this visit even when 1 is stored');
  assert.equal(decide({ stored: '0' }), false, 'a stored 0 is no choice: the default');
  ['2', 'true', 'yes', 'CDN', '', ' 1', '1 ', '01', 'null', 'undefined'].forEach(v => {
    assert.equal(decide({ search: '?cdn=' + encodeURIComponent(v) }), false, 'address value ' + JSON.stringify(v) + ' is no choice: the default');
    assert.equal(decide({ stored: v }), false, 'stored value ' + JSON.stringify(v) + ' is no choice: the default');
    assert.equal(decide({ stored: '1', search: '?cdn=' + encodeURIComponent(v) }), true, 'an unknown address value ' + JSON.stringify(v) + ' does not undo a stored 1');
  });
  assert.equal(decide({ search: '?cdn' }), false, 'a bare ?cdn is no choice');
  assert.equal(decide({ storageThrows: true }), false, 'no storage: the default');
  assert.equal(decide({ storageThrows: true, search: '?cdn=1' }), true, 'no storage, but the address says 1');
  assert.equal(decide({ locationThrows: true, stored: '1' }), true, 'no address to read: the stored choice');
  assert.equal(decide({ locationThrows: true, storageThrows: true }), false, 'neither: the default');
});

test('the drop script: on the CDN path React and ReactDOM are removed so support.js loads the pinned unpkg copies; otherwise they stay', () => {
  const keep = dropped(false), gone = dropped(true);
  assert.deepEqual(keep, { React: { r: 1 }, ReactDOM: { d: 1 } }, 'vendored path: both stay');
  assert.deepEqual(gone, { React: undefined, ReactDOM: undefined }, 'CDN path: both are gone');
  /* support.js asks for them only when they are missing (loadReactUmd), and checks the pinned SRI when it does */
  assert.match(support, /function loadReactUmd\(\) \{\s*const w = window;\s*if \(w\.React && w\.ReactDOM\) return Promise\.resolve\(\);/, 'support.js returns early when React is already there');
});
