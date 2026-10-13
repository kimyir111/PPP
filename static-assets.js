/* Content-hash caching of what the page loads (G13-4c; docs/GOALS/G13_PRODUCTIZATION.md, G13-D4; the engraver's rule of G4d-2 made general).

   A file asked for as  <path>?h=<12 hex>  where the 12 hex are the first 12 of the sha256 of the file's text with CRLF read as LF (binary files: of the bytes)
   is that exact content: the URL names it, so a browser may keep it for good ("public, max-age=31536000, immutable") and it is sent gzip when the browser
   takes it. Anything else - no ?h=, another hash (a stale page, a guess), a file type that is not hashed - is answered as before (.js .json .html no-store).
   Nothing is cached by a URL that does not name the content, so a deploy can never leave a stale script behind: the page the server hands out names
   the hash of every file at that moment (rewriteHead), and a page that was loaded before the deploy asks for the old hash and gets the new content as
   no-store (the old ?v=N URLs behave the same way).

   The served page is rewritten, not the source: "./scoregraph/rational.js?v=8" in the head of the app file becomes "./scoregraph/rational.js?h=<hash>"
   (the ?v=N stays in the source for a server that does not know this, and for the tests that read the file). Only the head is touched, and only a file
   that exists and is on the served list (static-allow.js). The hashes of the language catalogs, which the page asks for from i18n.js and not from a
   tag, travel in window.PPP_HASHES (hashMap). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const allow = require('./static-allow');

/* the types whose URL may carry a hash. .html is never one (the page is the thing that names the hashes); .mp3 and pictures keep their own cache headers */
const HASHABLE = new Set(['.js', '.json', '.css', '.woff2', '.woff']);
const TEXT = new Set(['.js', '.json', '.css']);
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MIN_GZIP = 256;

/* one entry per file: the hash (re-made when the file's mtime or size moved) and, once asked for, the gzip bytes of exactly that content */
const cache = new Map();
function hashBytes(buf, ext) {
  const body = TEXT.has(ext) ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf;
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
}
/* the entry of a file whose content `buf` and stat `st` the caller has in hand */
function entryOf(abs, st, buf) {
  const c = cache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;
  const e = { mtimeMs: st.mtimeMs, size: st.size, hash: hashBytes(buf, path.extname(abs).toLowerCase()), gz: null, gzWait: null };
  cache.set(abs, e);
  return e;
}
/* the hash of a file by its path (reads it only when the cache has nothing current), or null if there is no such file */
function hashOfFile(abs) {
  let st;
  try { st = fs.statSync(abs); } catch (e) { return null; }
  if (!st.isFile()) return null;
  const c = cache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.hash;
  try { return entryOf(abs, st, fs.readFileSync(abs)).hash; } catch (e) { return null; }
}

/* does this Accept-Encoding take gzip? (a token "gzip" or "*" without q=0; identity is always possible) */
function acceptsGzip(header) {
  const h = String(header || '');
  if (!h) return false;
  let star = null, gz = null;
  for (const part of h.split(',')) {
    const bits = part.trim().toLowerCase().split(';');
    const name = bits[0].trim();
    if (name !== 'gzip' && name !== '*') continue;
    let q = 1;
    for (const p of bits.slice(1)) { const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p); if (m) q = parseFloat(m[1]); }
    if (name === 'gzip') gz = q > 0; else star = q > 0;
  }
  return gz !== null ? gz : star === true;
}
/* does If-None-Match name this entity tag? (a list, "*", and the weak prefix are all read) */
function ifNoneMatchHas(header, etag) {
  const h = String(header || '').trim();
  if (!h) return false;
  if (h === '*') return true;
  return h.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
}

function gzipOnce(e, buf) {
  if (e.gz) return Promise.resolve(e.gz);
  if (!e.gzWait) {
    e.gzWait = new Promise((resolve, reject) => {
      zlib.gzip(buf, { level: 9 }, (err, out) => { if (err) { e.gzWait = null; reject(err); } else { e.gz = out; resolve(out); } });
    });
  }
  return e.gzWait;
}

/* The answer for a request whose ?h= matched: { status, headers, body }. Range is not honoured (a whole 200 is a legal answer to it, and a slice of a gzip
   body is of no use to anyone), and Accept-Ranges says so; HEAD gets the headers a GET would, with the Content-Length of the body that GET would send. */
async function immutableAnswer(req, e, buf, type) {
  /* a woff2 is compressed already: gzip would cost the server time and save the browser nothing */
  const gz = buf.length >= MIN_GZIP && !/^font\//.test(type) && acceptsGzip(req.headers['accept-encoding']);
  const etag = '"' + e.hash + (gz ? '-gz' : '') + '"';
  const headers = { 'Content-Type': type, 'Cache-Control': IMMUTABLE, 'Vary': 'Accept-Encoding', 'ETag': etag, 'Accept-Ranges': 'none' };
  if (ifNoneMatchHas(req.headers['if-none-match'], etag)) {
    delete headers['Content-Type'];
    return { status: 304, headers, body: Buffer.alloc(0) };
  }
  let body = buf;
  if (gz) { body = await gzipOnce(e, buf); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  return { status: 200, headers, body };
}

/* ---- the page ---- */

const TAG_RE = /<(?:script|link)\b[^>]*>/gi;
const ATTR_RE = /(\b(?:src|href)=")\.\/([^"?#]+)(\?[^"#]*)?(#[^"]*)?(")/g;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const CSS_URL_RE = /(\burl\(\s*['"]?)\.\/([^)'"?#]+)(\?[^)'"#]*)?(['"]?\s*\))/g;

function hashedUrlPart(root, rel) {
  let r = rel;
  if (r.indexOf('%') >= 0) { try { r = decodeURIComponent(r); } catch (e) { return null; } }
  if (!HASHABLE.has(path.extname(r).toLowerCase()) || !allow.isServed(r)) return null;
  const h = hashOfFile(path.join(root, r));
  return h ? '?h=' + h : null;
}
/* the head of the page with every local script, stylesheet and font url named by its content hash */
function rewriteHead(head, root) {
  head = head.replace(TAG_RE, tag => tag.replace(ATTR_RE, (all, pre, rel, q, frag, post) => {
    const h = hashedUrlPart(root, rel);
    return h ? pre + './' + rel + h + (frag || '') + post : all;
  }));
  return head.replace(STYLE_RE, block => block.replace(CSS_URL_RE, (all, pre, rel, q, post) => {
    const h = hashedUrlPart(root, rel);
    return h ? pre + './' + rel + h + post : all;
  }));
}

/* { "i18n/ko-KR.json": "<hash>", ... }: the hashes of the files the page asks for by name from a script (i18n.js builds the catalog url from it) */
function hashMap(root) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(path.join(root, 'i18n')); } catch (e) { names = []; }
  for (const n of names.sort()) {
    const rel = 'i18n/' + n;
    if (!allow.isServed(rel)) continue;
    const h = hashOfFile(path.join(root, rel));
    if (h) out[rel] = h;
  }
  return out;
}

/* the page text with the hashes in it: the head rewritten and window.PPP_HASHES set before any script runs (right after the charset, where PPP_BUILD goes) */
function preparePage(text, root) {
  const cut = text.indexOf('</head>');
  let out = cut < 0 ? text : rewriteHead(text.slice(0, cut), root) + text.slice(cut);
  const tag = '<script>window.PPP_HASHES=' + JSON.stringify(hashMap(root)) + ';</script>';
  const m = /<meta charset="utf-8">/i.exec(out);
  out = m ? out.slice(0, m.index + m[0].length) + '\n' + tag + out.slice(m.index + m[0].length) : out.replace(/<head>/i, h => h + '\n' + tag);
  return out;
}

module.exports = { HASHABLE, IMMUTABLE, entryOf, hashOfFile, hashBytes, acceptsGzip, ifNoneMatchHas, immutableAnswer, rewriteHead, hashMap, preparePage };
