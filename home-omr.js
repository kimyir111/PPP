/* G12-5: what the home-PC queue's kind 'omr' lets in and out (docs/GOALS/G12_OMR.md section 24).

   A person's PDF or photo of printed music is read by Audiveris on THEIR OWN PC (the worker, tools/home-worker/): the page images go up to the site, wait there
   in the free database until that PC asks for them, the PC reads them and sends back the MusicXML of each page, and the images are deleted. Nothing connects to
   the PC. Every rule about what may be sent either way is in this one file, so the site (home-jobs.js) and the worker (tools/home-worker/worker.js) hold the
   same bounds, like home-result.js does for notes.

     what goes UP     page images: PNG or JPEG, each at most 1.5 MB and 20 megapixels, at most 12 pages (24 when asked for) and 12 MB in all. They are decoded and
                      their header is read HERE (type, width, height): what the file says it is, not what the sender called it. Nothing else is accepted.
     what comes BACK  per page the MusicXML movements the engine wrote (the local helper's `movements`), the engine's name and version and the time it took.
                      Each document is checked as text without being parsed into a tree: no DOCTYPE other than the standard MusicXML one (which is removed:
                      nothing downstream reads a DTD), no entity declarations, no CDATA, no control characters, tags properly nested to a depth and a count that
                      MusicXML never needs, the root `score-partwise` or `score-timewise`. Everything else in the body is dropped, never stored.

   Pure: no I/O, no clock. */
'use strict';
const crypto = require('crypto');
const R = require('./home-result');

const MiB = 1048576;
const LIMITS = Object.freeze({
  /* a job: pages, and what a page and a job may weigh (the page downscales and re-encodes a photo to fit; a phone photo is 1-4 MB, a clean PDF page 0.3-0.8 MB as a grey PNG) */
  PAGES_MAX: 12,
  PAGES_MAX_LARGE: 24,
  PAGE_BYTES: Math.floor(1.5 * MiB),
  JOB_BYTES: 12 * MiB,
  PAGE_BYTES_MIN: 100,
  /* the picture's own size: a 1.5 MB PNG can be a white sheet of 100,000 x 100,000 pixels, which Audiveris on the person's PC would try to load (A4 at 300 DPI is 8.7 megapixels) */
  SIDE_MIN: 200,
  SIDE_MAX: 6000,
  PIXELS_MAX: 20 * 1000 * 1000,
  /* the answer: MusicXML of a page is 20-300 KB; a job's whole answer is capped (stored as JSONB, read once by the page) */
  RESULT_MAX_BYTES: 4 * MiB,
  MOVEMENTS_PER_PAGE: 16,
  XML_MAX_CHARS: 3 * MiB,
  /* a MusicXML page has 5,000-40,000 tags; ten times the biggest page measured is the budget */
  XML_MAX_TAGS: 400000,
  XML_MAX_DEPTH: 40,
  TITLE_MAX: 120,
  ERROR_MAX: 200,
  PAGE_MS_MAX: 6 * 3600 * 1000
});

const bad = (error, code, status) => ({ ok: false, error: error, code: code, status: status || 422 });

/* ---------------- what goes up: page images ---------------- */

/* The kind, width and height of a PNG or JPEG from its bytes; null for anything else (a GIF, an SVG, a PDF, a script named .png). Reads headers only. */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const depth = buf[24], colour = buf[25];
    if ([1, 2, 4, 8, 16].indexOf(depth) < 0 || [0, 2, 3, 4, 6].indexOf(colour) < 0 || buf[26] !== 0 || buf[27] !== 0 || buf[28] > 1) return null;
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let p = 2;
    for (let n = 0; n < 4096 && p + 4 <= buf.length; n++) {
      if (buf[p] !== 0xff) return null;
      let m = buf[p + 1];
      while (m === 0xff && p + 2 < buf.length) { p++; m = buf[p + 1]; }          /* fill bytes */
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m === 0xd9 || m === 0xda) return null;                                  /* the end, or the data, before any frame header */
      const len = buf.readUInt16BE(p + 2);
      if (len < 2) return null;
      /* a frame header: SOF0-SOF15 but not DHT (c4), JPG (c8) and DAC (cc) */
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (len < 8 || p + 9 > buf.length) return null;
        return { type: 'jpeg', width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5) };
      }
      p += 2 + len;
    }
  }
  return null;
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const B64_MAX_CHARS = Math.ceil(LIMITS.PAGE_BYTES / 3) * 4 + 4;
/* a page as the browser sends it: base64, or a data: URL of a PNG or JPEG. A Buffer, 'big' (too long to decode at all) or null (not base64). */
function decodePage(s) {
  if (typeof s !== 'string') return null;
  let t = s;
  const m = /^data:image\/(?:png|jpeg|jpg);base64,/i.exec(t);
  if (m) t = t.slice(m[0].length);
  if (!t.length) return null;
  if (t.length > B64_MAX_CHARS) return 'big';
  if (t.length % 4 !== 0 || !B64.test(t)) return null;
  return Buffer.from(t, 'base64');
}

/* One image's bytes -> { ok: true, type, width, height } or { ok: false, status, code, error, big? }: what the site checks of every page it is given and what the worker checks of every page it
   is handed (the site is trusted with the queue, not with what the PC's engine is made to open). n is the page's place, for the sentence. */
function checkImage(buf, n) {
  const at = n == null ? 'The image' : 'Page ' + n;
  if (!Buffer.isBuffer(buf) || buf.length < LIMITS.PAGE_BYTES_MIN) return bad(at + ' is not an image this accepts.', 'bad-image', 422);
  if (buf.length > LIMITS.PAGE_BYTES) return bad(at + ' is larger than ' + (LIMITS.PAGE_BYTES / MiB) + ' MB.', 'page-too-large', 413);
  const info = sniffImage(buf);
  if (!info) return bad(at + ' is not a PNG or JPEG image.', 'bad-image', 422);
  if (info.width < LIMITS.SIDE_MIN || info.height < LIMITS.SIDE_MIN || info.width > LIMITS.SIDE_MAX || info.height > LIMITS.SIDE_MAX || info.width * info.height > LIMITS.PIXELS_MAX) {
    return bad(at + ' is ' + info.width + ' x ' + info.height + ' pixels; ' + LIMITS.SIDE_MIN + ' to ' + LIMITS.SIDE_MAX + ' a side and ' + (LIMITS.PIXELS_MAX / 1e6) + ' megapixels is what this reads.', 'image-size', 422);
  }
  return { ok: true, type: info.type, width: info.width, height: info.height };
}

/* body.pages -> { ok, pages: [{ buf, type, width, height }], bytes } or { ok: false, status, code, error }. opts.large: up to 24 pages. */
function checkPages(list, opts) {
  const max = opts && opts.large === true ? LIMITS.PAGES_MAX_LARGE : LIMITS.PAGES_MAX;
  if (!Array.isArray(list) || !list.length) return bad('No page images were sent.', 'no-pages', 422);
  if (list.length > max) return bad('At most ' + max + ' pages in one job.', 'too-many-pages', 413);
  const out = [];
  let bytes = 0;
  for (let i = 0; i < list.length; i++) {
    const buf = decodePage(list[i]);
    if (buf === 'big') return bad('Page ' + (i + 1) + ' is larger than ' + (LIMITS.PAGE_BYTES / MiB) + ' MB.', 'page-too-large', 413);
    const info = checkImage(buf, i + 1);
    if (!info.ok) return info;
    bytes += buf.length;
    if (bytes > LIMITS.JOB_BYTES) return bad('The pages are more than ' + (LIMITS.JOB_BYTES / MiB) + ' MB together.', 'job-too-large', 413);
    out.push({ buf: buf, type: info.type, width: info.width, height: info.height });
  }
  return { ok: true, pages: out, bytes: bytes };
}

/* a short, stable name for these pages' content (not a secret: a hash of images the person sent): the same pages asked for twice while the first is waiting are the one job */
function fingerprint(pages) {
  const h = crypto.createHash('sha256');
  pages.forEach(p => { const b = Buffer.alloc(4); b.writeUInt32BE(p.buf.length, 0); h.update(b); h.update(p.buf); });
  return 'omr:' + h.digest('hex').slice(0, 24);
}

/* ---------------- what comes back: MusicXML ---------------- */

/* the standard MusicXML document type declaration, exactly: no internal subset ('[' ... ']') and no other identifier */
const DOCTYPE_STD = /^<!DOCTYPE\s+score-(?:partwise|timewise)\s+PUBLIC\s+"-\/\/Recordare\/\/DTD MusicXML [0-9.]{1,8} (?:Partwise|Timewise)\/\/EN"\s+"http:\/\/www\.musicxml\.org\/dtds\/(?:partwise|timewise)\.dtd"\s*>/;
/* control characters (but not tab, line feed, carriage return), the two noncharacters of the BMP's end, and a lone surrogate */
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/* an entity reference that is not one of the five or a character number (nothing can define another one: no DOCTYPE subset is accepted) */
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/;
const NAME_START = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const NAME_CHAR = c => NAME_START(c) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 58;

/* text -> { ok: true, xml } (the same text with the standard DOCTYPE removed) or { ok: false, code, error } */
function checkMusicXml(text, o) {
  o = Object.assign({ maxChars: LIMITS.XML_MAX_CHARS, maxTags: LIMITS.XML_MAX_TAGS, maxDepth: LIMITS.XML_MAX_DEPTH }, o || {});
  const no = (code, error) => ({ ok: false, code: code, error: error || 'The MusicXML is not usable (' + code + ').' });
  if (typeof text !== 'string' || !text) return no('empty');
  if (text.length > o.maxChars) return no('too-large');
  if (BAD_CHARS.test(text)) return no('bad-chars');
  if (text.indexOf('<!ENTITY') >= 0 || text.indexOf('<![CDATA[') >= 0) return no('entity');
  if (BAD_ENTITY.test(text)) return no('entity');
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = s.length;
  let i = 0;
  const ws = () => { while (i < n) { const c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } };
  ws();
  if (s.startsWith('<?xml', i) && /\s/.test(s.charAt(i + 5))) {
    const j = s.indexOf('?>', i);
    if (j < 0) return no('bad-xml');
    i = j + 2;
  }
  /* the prolog: comments, processing instructions, at most one DOCTYPE - and it must be the standard one, which is cut out */
  let cut = null;
  for (;;) {
    ws();
    if (s.startsWith('<!--', i)) { const j = s.indexOf('-->', i + 4); if (j < 0) return no('bad-xml'); i = j + 3; continue; }
    if (s.startsWith('<?', i)) { const j = s.indexOf('?>', i + 2); if (j < 0) return no('bad-xml'); i = j + 2; continue; }
    if (s.startsWith('<!', i)) {
      const m = cut ? null : DOCTYPE_STD.exec(s.slice(i, i + 400));
      if (!m) return no('doctype', 'A document type declaration other than the standard MusicXML one is not accepted.');
      cut = [i, i + m[0].length];
      i += m[0].length;
      continue;
    }
    break;
  }
  const stack = [];
  let tags = 0, rootDone = false, rootName = null;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      if (stack.length || /\S/.test(s.slice(i))) return no('bad-xml');
      break;
    }
    if (!stack.length && lt > i && /\S/.test(s.slice(i, lt))) return no('bad-xml');
    i = lt;
    if (s.startsWith('<!--', i)) { const j = s.indexOf('-->', i + 4); if (j < 0) return no('bad-xml'); i = j + 3; continue; }
    if (s.startsWith('<?', i)) { const j = s.indexOf('?>', i + 2); if (j < 0) return no('bad-xml'); i = j + 2; continue; }
    if (s.charAt(i + 1) === '!') return no('bad-xml');
    if (s.charAt(i + 1) === '/') {
      const j = s.indexOf('>', i);
      if (j < 0 || !stack.length) return no('bad-xml');
      if (s.slice(i + 2, j).trim() !== stack.pop()) return no('bad-xml');
      if (!stack.length) rootDone = true;
      i = j + 1;
      continue;
    }
    let k = i + 1;
    if (!NAME_START(s.charCodeAt(k))) return no('bad-xml');
    while (k < n && NAME_CHAR(s.charCodeAt(k))) k++;
    const name = s.slice(i + 1, k);
    let q = 0;
    for (; k < n; k++) {
      const c = s.charCodeAt(k);
      if (q) { if (c === q) q = 0; } else if (c === 34 || c === 39) q = c; else if (c === 62) break; else if (c === 60) return no('bad-xml');
    }
    if (k >= n) return no('bad-xml');
    const selfClosing = s.charCodeAt(k - 1) === 47;
    if (rootDone) return no('bad-xml');
    if (++tags > o.maxTags) return no('too-many-elements', 'The MusicXML has more elements than a page can hold.');
    if (rootName === null) {
      rootName = name;
      if (name !== 'score-partwise' && name !== 'score-timewise') return no('not-musicxml', 'The document is not MusicXML.');
    }
    if (!selfClosing) {
      stack.push(name);
      if (stack.length > o.maxDepth) return no('too-deep', 'The MusicXML is nested deeper than MusicXML ever is.');
    } else if (!stack.length) rootDone = true;
    i = k + 1;
  }
  if (rootName === null || stack.length || !rootDone) return no('bad-xml');
  return { ok: true, xml: cut ? s.slice(0, cut[0]) + s.slice(cut[1]) : s };
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9 ._+-]{0,39}$/;
const VERSION_RE = /^[0-9][0-9A-Za-z._+-]{0,19}$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* what the PC posts for a job of `o.pages` pages -> { ok: true, result, bytes } | { ok: false, error, code }.
   result = { v: 1, kind: 'omr', engine, engineVersion, ms, pages: [{ index, ok, ms, error?, movements? }] }. A page the engine could not read says why; at least one page must have been read. */
function validateOmrResult(body, o) {
  const want = o && Number.isInteger(o.pages) ? o.pages : null;
  if (!isObj(body)) return bad('The result is not an object.', 'bad-result');
  if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > LIMITS.PAGES_MAX_LARGE) return bad('The result has no pages list.', 'bad-result');
  if (want !== null && body.pages.length !== want) return bad('The result has ' + body.pages.length + ' pages; the job has ' + want + '.', 'bad-result');
  let engine = 'Audiveris';
  if (body.engine != null) {
    if (typeof body.engine !== 'string' || !NAME_RE.test(body.engine)) return bad('The engine name is not usable.', 'bad-meta');
    engine = body.engine;
  }
  let engineVersion = null;
  if (body.engineVersion != null) {
    if (typeof body.engineVersion !== 'string' || !VERSION_RE.test(body.engineVersion)) return bad('The engine version is not usable.', 'bad-meta');
    engineVersion = body.engineVersion;
  }
  let ms = 0;
  if (body.ms != null) {
    if (typeof body.ms !== 'number' || !Number.isFinite(body.ms) || body.ms < 0 || body.ms > LIMITS.PAGE_MS_MAX * LIMITS.PAGES_MAX_LARGE) return bad('The time is not usable.', 'bad-meta');
    ms = Math.round(body.ms);
  }
  const pages = [];
  let read = 0;
  for (let i = 0; i < body.pages.length; i++) {
    const p = body.pages[i];
    if (!isObj(p)) return bad('Page ' + (i + 1) + ' is not an object.', 'bad-result');
    if (p.index != null && p.index !== i) return bad('Page ' + (i + 1) + ' is out of order.', 'bad-result');
    if (typeof p.ok !== 'boolean') return bad('Page ' + (i + 1) + ' does not say whether it was read.', 'bad-result');
    let pms = 0;
    if (p.ms != null) {
      if (typeof p.ms !== 'number' || !Number.isFinite(p.ms) || p.ms < 0 || p.ms > LIMITS.PAGE_MS_MAX) return bad('Page ' + (i + 1) + ' has no usable time.', 'bad-result');
      pms = Math.round(p.ms);
    }
    if (!p.ok) {
      pages.push({ index: i, ok: false, ms: pms, error: R.cleanText(p.error, LIMITS.ERROR_MAX) || 'This page could not be read.' });
      continue;
    }
    if (!Array.isArray(p.movements) || !p.movements.length || p.movements.length > LIMITS.MOVEMENTS_PER_PAGE) return bad('Page ' + (i + 1) + ' has no usable movements.', 'bad-result');
    const movements = [];
    for (let m = 0; m < p.movements.length; m++) {
      const c = checkMusicXml(p.movements[m]);
      if (!c.ok) return bad('Page ' + (i + 1) + ', movement ' + (m + 1) + ': ' + c.error, 'bad-xml');
      movements.push(c.xml);
    }
    pages.push({ index: i, ok: true, ms: pms, movements: movements });
    read++;
  }
  if (!read) return bad('No page was read.', 'nothing-read');
  const result = { v: 1, kind: 'omr', engine: engine, engineVersion: engineVersion, ms: ms, pages: pages };
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > LIMITS.RESULT_MAX_BYTES) return bad('The result is larger than ' + Math.round(LIMITS.RESULT_MAX_BYTES / MiB) + ' MB.', 'too-large');
  return { ok: true, result: result, bytes: bytes };
}

module.exports = { LIMITS, sniffImage, decodePage, checkImage, checkPages, fingerprint, checkMusicXml, validateOmrResult, DOCTYPE_STD };
