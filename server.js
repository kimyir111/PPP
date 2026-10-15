#!/usr/bin/env node
/* PPP web server — static app + email/password auth + progress sync + shared scores.
   Locally uses data/store.json. On Render, DATABASE_URL selects Postgres. */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8777;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const SECRET = process.env.SESSION_SECRET || 'ppp-dev-session-secret-change-me';
const COOKIE = 'ppp_session';
const MAX_AGE = 30 * 24 * 3600;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'
  || process.env.NODE_ENV === 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.musicxml': 'application/vnd.recordare.musicxml+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  /* G13-3: the only .md the site serves is THIRD_PARTY_NOTICES.md, and a person follows a link to it from Settings: shown as text, not downloaded (browsers download text/markdown) */
  '.md': 'text/plain; charset=utf-8'
};

const BLOCKED = new Set(['node_modules', 'tools', '.git', 'data', 'tests']);
/* G13-5 (docs/GOALS/G13 D16, TD26): BLOCKED is the old lock and stays. A file is handed out only when static-allow.js names it - the page, its
   modules, the catalogues, the piano and the language files; the server's own sources, deploy files, docs/ and the rest are a 404. */
const staticAllow = require('./static-allow');

/* G4d-2 (docs/GOALS/G04 §16; DECISIONS G4-D2-5), made general by G13-4c (docs/GOALS/G13 G13-D4): a script, catalog, stylesheet or font is kept by the
   browser for good when it is asked for by its content hash - ?h=<the first 12 hex of the sha256 of the file with CRLF read as LF> - and the hash is the
   file's own; gzip when the browser takes it. Every other request is answered as before (.js .json .html no-store). The page the server hands out names the
   hash of each file it loads (static-assets.js: rewriteHead, hashMap), so a deploy cannot leave a stale script behind. */
const assets = require('./static-assets');

function send(res, status, body, headers) {
  const extra = headers || {};
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    extra['Content-Type'] = extra['Content-Type'] || 'application/json; charset=utf-8';
    body = JSON.stringify(body);
  }
  extra['X-Content-Type-Options'] = 'nosniff';
  res.writeHead(status, extra);
  res.end(body);
}

function jsonError(res, status, message, extra) {
  send(res, status, Object.assign({ error: message }, extra || {}));
}

function httpsDownload(url, dest, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('too many redirects'));
    https.get(url, { timeout: 60000, headers: { 'User-Agent': 'PPP/1' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsDownload(res.headers.location, dest, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function parseYoutubeWatch(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    /* a video id is exactly 11 characters of [A-Za-z0-9_-] (G10b-1: it used to be "6 or more", and the id is handed to yt-dlp and to a worker) */
    if (host === 'youtu.be') {
      const m = /^\/([A-Za-z0-9_-]{11})$/.exec(u.pathname);
      if (m) return { id: m[1], url: 'https://www.youtube.com/watch?v=' + m[1] };
    } else if (host === 'youtube.com' && u.pathname === '/watch') {
      const v = u.searchParams.get('v') || '';
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return { id: v, url: 'https://www.youtube.com/watch?v=' + v };
    } else if (host === 'youtube.com') {
      const m = /^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(u.pathname);
      if (m) return { id: m[2], url: 'https://www.youtube.com/watch?v=' + m[2] };
    }
  } catch (e) {}
  return null;
}

function looksLikeAudioFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (n >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
    if (n >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
    if (n >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
    if (n >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
    if (n >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return true;
    if (n >= 4 && buf.toString('ascii', 0, 4) === 'RIFF') return true;
    return false;
  } catch (e) { return false; }
}

function audioTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

function pipeAudioFile(res, file, dir) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) {}
  res.writeHead(200, {
    'Content-Type': audioTypeFor(file),
    'Content-Length': size,
    'Cache-Control': 'no-store'
  });
  const stream = fs.createReadStream(file);
  stream.pipe(res);
  const done = () => rmDir(dir);
  stream.on('close', done);
  stream.on('error', () => { done(); if (!res.headersSent) jsonError(res, 500, 'Read failed'); });
}

function httpGetText(url, timeoutMs, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('too many redirects'));
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      timeout: timeoutMs || 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PPP/1',
        'Accept': 'application/json, */*'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetText(new URL(res.headers.location, url).href, timeoutMs, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      let n = 0;
      res.on('data', c => { n += c.length; if (n < 1024 * 1024) chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function loaderDownloadUrl(p) {
  if (!p || typeof p !== 'object') return null;
  const cand = [p.download_url, p.url, p.file, p.text && p.text.url];
  for (let i = 0; i < cand.length; i++) {
    const u = String(cand[i] || '');
    if (/^https?:\/\//i.test(u)) return u;
  }
  return null;
}

async function loaderOnce(parsed, dir, fmt) {
  const startUrl = 'https://loader.to/ajax/download.php?format=' + fmt + '&url=' + encodeURIComponent(parsed.url);
  let start;
  try { start = JSON.parse(await httpGetText(startUrl, 15000)); }
  catch (e) { throw new Error('loader start'); }
  const progress = start && start.progress_url;
  if (!progress) throw new Error('loader progress');
  const ready = loaderDownloadUrl(start);
  if (ready) {
    const dest = path.join(dir, fmt === 'm4a' ? 'audio.m4a' : 'audio.mp3');
    await httpGetToFile(ready, dest, { timeout: 45000 });
    if (!looksLikeAudioFile(dest)) throw new Error('not audio');
    return dest;
  }
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    let p;
    try { p = JSON.parse(await httpGetText(progress, 10000)); }
    catch (e) { continue; }
    const durl = loaderDownloadUrl(p);
    if (durl) {
      const dest = path.join(dir, fmt === 'm4a' ? 'audio.m4a' : 'audio.mp3');
      await httpGetToFile(durl, dest, { timeout: 45000 });
      if (!looksLikeAudioFile(dest)) throw new Error('not audio');
      return dest;
    }
  }
  throw new Error('loader timeout');
}

async function fetchViaLoaderTo(parsed, dir) {
  try { return await loaderOnce(parsed, dir, 'mp3'); }
  catch (e) {
    if (e && /timeout/i.test(String(e.message))) throw e;
    return loaderOnce(parsed, dir, 'm4a');
  }
}

function httpGetToFile(url, dest, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeout || 20000;
  const maxBytes = opts.maxBytes || 80 * 1024 * 1024;
  const hops = opts.hops || 0;
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('too many redirects'));
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      timeout: timeoutMs,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PPP/1',
        'Accept': '*/*'
      }, opts.headers || {})
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return httpGetToFile(next, dest, Object.assign({}, opts, { hops: hops + 1 })).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type.indexOf('text/html') >= 0 || type.indexOf('application/json') >= 0) {
        res.resume();
        return reject(new Error('not audio'));
      }
      const file = fs.createWriteStream(dest);
      let n = 0;
      let limited = false;
      res.on('data', c => {
        n += c.length;
        if (n > maxBytes && !limited) {
          limited = true;
          req.destroy();
          try { file.destroy(); } catch (e) {}
          reject(new Error('too large'));
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        if (limited) return;
        if (!looksLikeAudioFile(dest)) return reject(new Error('not audio'));
        resolve(dest);
      }));
      file.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function runYtDlp(ytdlp, watch, extraArgs, timeoutMs) {
  return new Promise(resolve => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-yt-'));
    const args = [
      '--no-playlist', '--no-progress', '--newline', '--no-warnings',
      '--fixup', 'never',
      '--force-ipv4',
      '--socket-timeout', '20',
      '--retries', '2',
      '--js-runtimes', 'node:' + process.execPath,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/140/139/18/bestaudio',
      '--max-filesize', '80M',
      '--match-filter', '!is_live',
      '-o', path.join(dir, 'audio.%(ext)s')
    ];
    if (extraArgs && extraArgs.length) args.push.apply(args, extraArgs);
    args.push('--', watch);
    const child = spawn(ytdlp, args, { windowsHide: true, cwd: dir });
    let tail = '';
    const onText = c => { tail = (tail + c.toString('utf8')).slice(-4000); };
    child.stdout.on('data', onText);
    child.stderr.on('data', onText);
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      done({ file: null, dir: dir, tail: tail, timedOut: true });
    }, timeoutMs || 70000);
    child.on('close', () => {
      clearTimeout(timer);
      let file = null;
      try {
        file = fs.readdirSync(dir).map(f => path.join(dir, f)).filter(f => {
          try { return fs.statSync(f).isFile() && fs.statSync(f).size > 256 && looksLikeAudioFile(f); }
          catch (e) { return false; }
        })[0] || null;
      } catch (e) {}
      done({ file: file, dir: dir, tail: tail, timedOut: false });
    });
    child.on('error', () => {
      clearTimeout(timer);
      done({ file: null, dir: dir, tail: tail, timedOut: false, spawnError: true });
    });
  });
}

async function fetchYoutubeAudioFile(parsed) {
  /* yt-dlp is installed in the hosted build by render.yaml. Prefer it there
     too; the third-party proxy remains the fallback for blocked datacenter IPs. */
  const hosted = process.env.PPP_YOUTUBE_PROXY_FIRST === '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-yt-'));
  let lastTail = '';
  /* Datacenter IPs can be bot-walled by YouTube. Set
     PPP_YOUTUBE_PROXY_FIRST=1 to use the proxy before yt-dlp; the default
     tries the installed binary first and falls back to the proxy. */
  if (hosted) {
    try {
      const file = await fetchViaLoaderTo(parsed, dir);
      return { file: file, dir: dir, tail: lastTail };
    } catch (e) {
      lastTail = String(e && e.message || 'proxy');
      rmDir(dir);
      if (lastTail) console.error('[youtube-audio]', lastTail.slice(-800));
      return { file: null, dir: null, tail: lastTail };
    }
  }
  const ytdlp = await findYtDlp();
  if (ytdlp) {
    const got = await runYtDlp(ytdlp, parsed.url, [], 70000);
    if (got.file) {
      rmDir(dir);
      return got;
    }
    lastTail = (lastTail + '\n' + (got.tail || '')).slice(-4000);
    rmDir(got.dir);
  }
  try {
    const file = await fetchViaLoaderTo(parsed, dir);
    return { file: file, dir: dir, tail: lastTail };
  } catch (e) {
    lastTail = (lastTail + '\n' + (e && e.message || '')).slice(-4000);
  }
  rmDir(dir);
  if (lastTail) console.error('[youtube-audio]', lastTail.slice(-800));
  return { file: null, dir: null, tail: lastTail };
}

let _ytdlp = null;
function findYtDlp() {
  if (_ytdlp) return Promise.resolve(_ytdlp);
  const exe = process.platform === 'win32' ? '.exe' : '';
  const local = [
    process.env.PPP_YTDLP,
    path.join(ROOT, 'tools', 'yt-dlp' + exe),
    path.join(ROOT, 'tools', 'yt-dlp')
  ].filter(Boolean).find(c => { try { return fs.existsSync(c); } catch (e) { return false; } });
  if (local) { _ytdlp = local; return Promise.resolve(local); }
  if (process.platform === 'win32') return Promise.resolve(null);
  const dest = path.join(os.tmpdir(), 'ppp-yt-dlp');
  return httpsDownload('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', dest)
    .then(() => {
      try { fs.chmodSync(dest, 0o755); } catch (e) {}
      _ytdlp = dest;
      return dest;
    })
    .catch(() => null);
}

/* `drain`, when given, is how much of an oversized body is read and thrown away so the caller can still answer 413 on
   an open connection (a browser shows a reset, not the answer, when the server hangs up mid-upload). Beyond it the
   connection is cut as before. Either way the promise rejects with code TOO_LARGE. */
const bodyReader = require('./body-reader');
/* G12-5 (the two security reviews of PR 269): every JSON body of this server is read by body-reader.js - the same function the home-PC queue uses. Before it, one socket of 1.4 million
   1-byte writes (1.4 MB, inside every cap) held about 350 bytes of Buffer per byte and ended the process by its heap in ten seconds, on /api/auth/login and everywhere else. Now: chunks are
   coalesced as they arrive, a body has 60 s in all and 10 s without a byte (the socket is cut), and its JSON structure is bounded as it arrives (a container per 16 bytes at the most, depth 80,
   or the few fields of a small body). A refusal rejects with code TOO_LARGE | SHAPE | SLOW | ABORTED; every caller answers 400 or 413 for any rejection. */
/* (PPP_BODY_TOTAL_MS and PPP_BODY_IDLE_MS only let a test see a deadline pass in seconds; nothing sets them in production) */
const BODY_TOTAL_MS = parseInt(process.env.PPP_BODY_TOTAL_MS, 10) || 60 * 1000;
const BODY_IDLE_MS = parseInt(process.env.PPP_BODY_IDLE_MS, 10) || 10 * 1000;
function readBody(req, limit, drain, shape) {
  const max = limit || 2 * 1024 * 1024;
  return bodyReader.readBody(req, { limit: max, drain: drain, shape: shape || bodyReader.stockShape(max), totalMs: BODY_TOTAL_MS, idleMs: BODY_IDLE_MS, destroyOnSlow: true });
}
/* the bodies of a few fields (an email and a password, {listed}): 64 KB at the most, 8 containers, depth 6 */
const SMALL_BODY_BYTES = 64 * 1024;

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, value, maxAge) {
  const parts = [
    COOKIE + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + (maxAge == null ? MAX_AGE : maxAge)
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const next = prev ? [].concat(prev, parts.join('; ')) : parts.join('; ');
  res.setHeader('Set-Cookie', next);
}

function clearCookie(res) {
  setCookie(res, '', 0);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$16384$8$1$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded || '').split('$');
    if (parts[0] !== 'scrypt' || parts.length < 6) return false;
    const N = +parts[1], r = +parts[2], p = +parts[3];
    const salt = Buffer.from(parts[4], 'hex');
    const hash = Buffer.from(parts[5], 'hex');
    const check = crypto.scryptSync(password, salt, hash.length, { N: N, r: r, p: p });
    return crypto.timingSafeEqual(hash, check);
  } catch (e) {
    return false;
  }
}

function signSession(uid) {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ uid: uid, exp: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function readSession(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch (e) { return null; }
  if (!data || !data.uid || !data.exp || data.exp < Date.now()) return null;
  return data;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1 || email.length > 320) return null;
  const domain = email.slice(at + 1);
  if (domain.indexOf('.') < 1) return null;
  return email;
}

function clipName(value, email) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned.slice(0, 80);
  const local = (email || '').split('@')[0].replace(/[._]/g, ' ').trim();
  return (local || 'Pianist').slice(0, 80);
}

function publicUser(u) {
  return { id: u.id, email: u.email, displayName: u.displayName };
}

/* ---------------- shared scores ----------------
   A shared score is a copy of the notes only: never the practice history or
   memory record that goes with it at home. Listed ones appear in the Shared
   Scores tab; every one opens by its link. */
const SHARE_MAX_BYTES = 4 * 1024 * 1024;
const SHARES_PER_USER = 200;
const SHARE_LIST_LIMIT = 250;
/* G13-5: the public list comes a page at a time (it was every listed score at once: 681 KB for 110). Without ?limit a page is SHARE_PAGE rows; ?mine=1 keeps its
   own default (SHARE_LIST_LIMIT: an account has at most SHARES_PER_USER, and the page marks its songs "shared" from that whole list). The answer is
   { shares, next } - next is an opaque cursor for the following page, or null at the end; the first page of the public list also names the genres that have a
   score ({ genres }), which the page's filter chips are made from. An older page reads only .shares and shows the newest SHARE_PAGE. */
const SHARE_PAGE = 24;
const SHARE_PAGE_MAX = 100;
/* a cursor is where the last row of a page stands in the order (updated_at, id), base64url of [updatedAt, id] - checked on the way in, never trusted */
function shareCursorOf(row) {
  const t = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString();
  return Buffer.from(JSON.stringify([t, row.id]), 'utf8').toString('base64url');
}
function readShareCursor(text) {
  try {
    if (typeof text !== 'string' || text.length > 200 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
    const a = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (!Array.isArray(a) || a.length !== 2 || typeof a[0] !== 'string' || typeof a[1] !== 'string') return null;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(a[0]) || !Number.isFinite(Date.parse(a[0])) || !/^[\w-]{1,40}$/.test(a[1])) return null;
    return { t: new Date(a[0]).toISOString(), id: a[1] };
  } catch (e) { return null; }
}
/* Guest link sharing (share-guest.js): the limits that keep a public write endpoint small. */
const guestShare = require('./share-guest');
/* G10b-1 / G10b-2: the home-PC transcription queue (home-jobs.js; docs/GOALS/G10B_HOME_WORKER.md) and where it is kept. It needs no account: a PC link is a pair of
   secrets any browser can make (/api/pc-links), and the queue is keyed by the link */
const homeJobs = require('./home-jobs');
const homeJobsStore = require('./home-jobs-store');
/* G13-S0 (docs/GOALS/G13_PRODUCTIZATION.md section 7): "use my songs on other devices", a library behind a secret code, no account. NOT MOUNTED unless PPP_SYNC=1: its routes
   are 404 like any unknown path, its modules are not even loaded, and the boot makes none of its tables. */
const SYNC_ON = process.env.PPP_SYNC === '1';
const syncStoreMod = SYNC_ON ? require('./sync-store') : null;
const GUEST = guestShare.GUEST;
const guestLimits = {
  /* creates per address; creates for the whole server; requests that failed validation, per address */
  ip: guestShare.slidingWindow(GUEST.PER_IP_PER_HOUR, GUEST.HOUR_MS),
  all: guestShare.slidingWindow(GUEST.GLOBAL_PER_HOUR, GUEST.HOUR_MS),
  fails: guestShare.slidingWindow(GUEST.FAILS_PER_IP_PER_HOUR, GUEST.HOUR_MS)
};
/* G13 no login: a guest's POST into the public list is rationed again, a day at a time: per browser key, per address and for the site (in memory, like the hourly
   limits; what survives a restart are the caps on posts held, which the store counts). A request takes one place for every write that leaves a post LISTED: a new
   post, a post that is sent again, a taken-down one put back. Taking one down, and reading, cost nothing. */
const guestPosts = {
  key: guestShare.slidingWindow(GUEST.POST_PER_KEY_PER_DAY, GUEST.DAY_MS),
  ip: guestShare.slidingWindow(GUEST.POST_PER_IP_PER_DAY, GUEST.DAY_MS),
  all: guestShare.slidingWindow(GUEST.POST_GLOBAL_PER_DAY, GUEST.DAY_MS)
};
/* On Render with no SESSION_SECRET the address tag is a hash with a key everybody can read: no guest post is taken (and it is said once, loudly, at the start). */
const GUEST_POSTS_NO_SECRET = !!process.env.RENDER && !process.env.SESSION_SECRET;
/* null when this request may post, else the refusal { status, error, code }; nothing is left taken on a refusal. `free`: it is a post put back the same day it was listed
   (guestShare.recentlyListed): the same post, so no new place of the day is taken - the switch and the secret still hold, and so do the caps on what is held. */
function takeGuestPost(ip, gid, free) {
  /* the owner's switch: PPP_GUEST_POSTS=0 refuses every new guest post (the page says there is no room right now); posts already made stay until they end or are taken down. Links are not affected. */
  if (process.env.PPP_GUEST_POSTS === '0' || GUEST_POSTS_NO_SECRET) return { status: 503, code: 'busy', error: guestShare.BUSY };
  if (free) return null;
  if (!guestPosts.key.take(gid)) return { status: 429, code: 'too-many-posts', error: 'This browser has posted as many scores today as a guest may. Try again tomorrow.' };
  if (!guestPosts.ip.take(ip)) {
    guestPosts.key.release(gid);
    return { status: 429, code: 'too-many-posts', error: 'As many scores as a guest may post in a day have been posted from here. Try again tomorrow.' };
  }
  if (!guestPosts.all.take('all')) {
    guestPosts.key.release(gid); guestPosts.ip.release(ip);
    return { status: 503, code: 'busy', error: guestShare.BUSY };
  }
  return null;
}
function releaseGuestPost(ip, gid) { guestPosts.key.release(gid); guestPosts.ip.release(ip); guestPosts.all.release('all'); }
/* the address of a request as every guest limit counts it: an IPv6 address is its /48 (the biggest block one site is given; a /64 or a /56 of it is the same place), an IPv4-mapped
   one is the IPv4 (home-jobs.js addrKey, which the signup limit and the PC links use). The windows, the held counts and the address tag are all of this one name. */
const guestPlaceOf = req => homeJobs.addrKey(guestShare.clientAddress(req).ip || 'unknown');
/* the keyed hash of the address a listed guest post was made from (an IPv6 address counts as its /48, as for the PC links and the signup limit): kept only on a post
   that is listed, for the cap per address and for the owner's read-only look at growth (tools/shares-admin/list.js); cleared when the post is taken down */
const guestAddrKey = crypto.createHmac('sha256', SECRET).update('ppp-guest-post-address').digest();
const guestAddrTagOf = ip => crypto.createHmac('sha256', guestAddrKey).update(homeJobs.addrKey(ip)).digest('hex').slice(0, 16);
/* an oversized guest body is read this far and thrown away, so the answer is a 413 and not a reset */
const GUEST_DRAIN_BYTES = 16 * 1024 * 1024;
const GUEST_TOO_BIG = 'That score is too large to share (the limit is 1 MB, about 4,000 notes). Share a part of it.';
/* a constant for pg_advisory_xact_lock: guest creates take turns */
const GUEST_LOCK_KEY = 727001;
/* G13-5 (TD26): who may make an account, and how fast. Making one costs a scrypt on the one thread, and a row for good. Three limits, each from one address
   (an IPv6 address counts as its /48: home-jobs.js addrKey; the address is kept only as a keyed hash, like the PC links') and one for the whole site:
   every request to the route (it costs the scrypt before it can be answered), accounts made per hour and per day from an address, and accounts made per hour by
   everybody. The accounts are counted from the users table (created_at, created_ip_tag), so a restart does not forget them; the requests are counted in memory,
   as the login limit is. A request from this machine itself (the socket, no proxy header) is not limited per address: that is a developer's server. */
const signupLimit = require('./signup-limit');
const SIGNUP = signupLimit.SIGNUP;
const signupAttempts = guestShare.slidingWindow(SIGNUP.ATTEMPTS, SIGNUP.ATTEMPT_MS);
const signupSerial = signupLimit.serial();
const signupKey = crypto.createHmac('sha256', SECRET).update('ppp-signup-address').digest();
const signupTagOf = ip => crypto.createHmac('sha256', signupKey).update(homeJobs.addrKey(ip)).digest('hex').slice(0, 16);
/* G13-7b (U5): POST /api/stats takes the anonymous counters of a page (client-stats.js: what is accepted, what is kept - totals in memory, one `stats:` line an hour). One browser sends one a visit, so
   an address (a keyed hash made new at every start, held ten minutes: the same trick as the signup tag, with a key that is not the session secret) may send STATS_PER_WINDOW in STATS_WINDOW_MS
   (a classroom or a campus behind one address is a few hundred visits; more are not counted, and answered 429, which the page never looks at; each beacon only adds capped numbers, so the limit protects
   nothing but the log's tidiness). The machine itself (the socket, loopback) is not limited: a developer's
   server, and the browser suites that close many pages. */
const clientStats = require('./client-stats');
const STATS_PER_WINDOW = parseInt(process.env.PPP_STATS_BEACONS, 10) || 300;
const STATS_WINDOW_MS = 10 * 60 * 1000;
const statsBeacons = guestShare.slidingWindow(STATS_PER_WINDOW, STATS_WINDOW_MS, undefined, 5000);
const statsKey = crypto.randomBytes(32);
const statsTagOf = ip => crypto.createHmac('sha256', statsKey).update(homeJobs.addrKey(ip)).digest('hex').slice(0, 16);
const STATS_SHAPE = Object.freeze({ tokens: 160, containers: 8, depth: 3 });

/* A store failure is one line in the log, and at most a few lines a minute, not a stack per request: a request that
   makes the store fail can be sent over and over. */
const storeLog = { t: 0, n: 0, dropped: 0 };
function logStoreError(e, kind) {
  serverStats.storeError(kind);
  const now = Date.now();
  if (now - storeLog.t > 60000) {
    if (storeLog.dropped) console.error('Share store errors not logged in the last minute: ' + storeLog.dropped);
    storeLog.t = now; storeLog.n = 0; storeLog.dropped = 0;
  }
  if (storeLog.n++ < 5) console.error('Share store error: ' + ((e && (e.code || e.name)) || 'error') + ' ' + String((e && e.message) || e).split('\n')[0].slice(0, 200));
  else storeLog.dropped++;
}
/* G13-7a (G13-D11): counters of requests, 5xx answers and store errors by route class, one `stats:` line an hour (server-stats.js). Counting only. */
const serverStats = require('./server-stats');
/* where the client address came from, said once (after a deploy, to check it against the real headers) */
let guestSourceLogged = false;
const DATA_DIR = process.env.PPP_DATA_DIR ? path.resolve(process.env.PPP_DATA_DIR) : path.join(ROOT, 'data');

function newShareId() {
  return crypto.randomBytes(9).toString('base64url');
}

function clipText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* the later of two end dates (ISO text or a Date), as ISO text */
function laterIso(a, b) {
  const t = x => (x instanceof Date ? x.getTime() : Date.parse(x));
  const ta = t(a), tb = t(b);
  return new Date(Number.isFinite(ta) && ta > tb ? ta : tb).toISOString();
}

/* Just enough of a score to be one: measures and notes as arrays. */
function validScore(s) {
  const isObj = x => !!x && typeof x === 'object';
  return !!(s && typeof s === 'object' && Array.isArray(s.measures) && s.measures.length
    && s.measures.length <= 5000 && Array.isArray(s.notes)
    && s.measures.every(isObj) && s.notes.every(isObj));
}

/* G13-3 (G13 doc, U9): a score made from a YouTube link is for the person's own practice. It is not posted to the PUBLIC Shared Scores (an account's
   "listed" share); its link can still be sent, as before. The page says so in the share dialog and sets `youtubeDerived` from the song's origin (a score
   its transcription made from a YouTube link's audio, an arrangement of one, or a copy somebody added that carried the mark: youtubeDerivedOf in the page);
   here only that is read from what arrives: the payload's flag, and the mark `source.youtubeDerived` inside the score (which is what a stored copy carries).
   A `source.kind` of 'youtube' alone is NOT read: a hymn or a catalogue score with a performance to watch has one, and it is not made from that audio.
   This is a policy guard, not a security boundary: the server only knows what the client says, so a modified or older client can leave the marks out. It keeps
   an honest page from posting by mistake and gives a person who is told "no" a reason; it cannot prove where a score came from. Shares that are already
   posted are not touched. */
const YOUTUBE_NOT_PUBLIC = 'A score made from a YouTube link cannot be posted to Shared Scores. You can still send its link.';
function youtubeDerivedShare(score, flag) {
  if (flag === true) return true;
  const src = score && typeof score === 'object' ? score.source : null;
  return !!(src && typeof src === 'object' && src.youtubeDerived === true);
}

/* What the list shows: no score, only the preview drawn on its card. */
function shareCard(row, viewer) {
  const mine = ownsShare(viewer, row);
  /* G13 no login: what the list shows is made safe on the way OUT as well as on the way in (rows stored before the rules, or written by a store I do not control): the text
     cleaned of controls and bidi overrides, and the preview - which the page's engraver DRAWS - rebuilt from what a preview is (guestShare.normalizePreview) */
  const T = guestShare.cleanText;
  const card = {
    id: row.id, title: T(row.title, 120), composer: T(row.composer, 160), kind: T(row.kind, 24), genre: T(row.genre || '', 32),
    measures: row.measures, owner: T(row.ownerName, 160), mine: mine,
    songKey: mine ? row.songKey : undefined,
    listed: !!row.listed, preview: row.preview ? guestShare.normalizePreview(row.preview, 4) : null,
    createdAt: row.createdAt, updatedAt: row.updatedAt
  };
  /* only a guest link has an end date; and only a guest's row is marked, so the page can say "Guest" in the person's language (the owner name stays "Guest") */
  if (row.expiresAt) card.expiresAt = row.expiresAt;
  if (guestShare.isGuestOwner(row.ownerId)) card.guest = true;
  return card;
}

/* The viewer of a request: the signed-in user, and the guest key's owner id when the request carries one.
   A guest key never gives the rights of an account; it only names the links its own browser made. */
function ownsShare(viewer, row) {
  if (!viewer) return false;
  return viewer.id === row.ownerId || (!!viewer.guestId && guestShare.sameOwner(viewer.guestId, row.ownerId));
}

/* ---------------- store ---------------- */
function fileStore() {
  const file = path.join(DATA_DIR, 'store.json');
  const sharesFile = path.join(DATA_DIR, 'shares.json');
  const dir = path.dirname(file);
  function load() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { users: [], progress: {} }; }
  }
  function save(db) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  }
  return {
    jobStore: homeJobsStore.fileJobStore(DATA_DIR),
    syncStore: SYNC_ON ? syncStoreMod.fileSyncStore(DATA_DIR) : null,
    async ready() { return true; },
    async findByEmail(email) {
      return load().users.find(u => u.email === email) || null;
    },
    async findById(id) {
      return load().users.find(u => u.id === id) || null;
    },
    async createUser(user) {
      const db = load();
      if (db.users.some(u => u.email === user.email)) {
        const err = new Error('exists'); err.code = 'exists'; throw err;
      }
      db.users.push(user);
      save(db);
      return user;
    },
    /* accounts made through the signup route lately, for its limit: all of them in the last hour, and those of one address tag in the last hour and day */
    async countSignups(tag, nowMs) {
      const made = { siteHour: 0, addrHour: 0, addrDay: 0 };
      load().users.forEach(u => {
        const t = Date.parse(u.createdAt);
        if (!u.ipTag || !(t > nowMs - SIGNUP.DAY_MS)) return;
        const hour = t > nowMs - SIGNUP.HOUR_MS;
        if (hour) made.siteHour++;
        if (u.ipTag === tag) { made.addrDay++; if (hour) made.addrHour++; }
      });
      return made;
    },
    /* the keyed hash of the address an account was made from is kept for the limit's day, and two days at most (privacy: an address, even hashed, is not kept for good) */
    async purgeSignupTags(nowMs) {
      const db = load();
      let n = 0;
      db.users.forEach(u => { if (u.ipTag && !(Date.parse(u.createdAt) > nowMs - 2 * SIGNUP.DAY_MS)) { delete u.ipTag; n++; } });
      if (n) save(db);
      return n;
    },
    async getProgress(userId) {
      const db = load();
      return db.progress[userId] || null;
    },
    async putProgress(userId, payload) {
      const db = load();
      db.progress[userId] = { payload: payload, updatedAt: new Date().toISOString() };
      save(db);
    },
    /* Shares live in a file of their own: they carry whole scores, and the
       account file is read on every request. */
    async listShares(opts) {
      /* ownerIds: everything these owners hold (an account's, and the guest key's of this browser), listed or not; else the listed ones. A guest's row past its end date is
         gone from every list at once, swept or not. */
      const owners = opts.ownerIds || (opts.ownerId ? [opts.ownerId] : null);
      const nowMs = Date.now();
      const rows = loadShares().filter(r => !guestShare.expired(r, nowMs) && (owners ? owners.indexOf(r.ownerId) > -1 : r.listed));
      /* newest first, the id breaks a tie: the order a cursor stands in (compared by code units here and in the cursor's test, never by the locale) */
      const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      rows.sort((a, b) => cmp(String(b.updatedAt), String(a.updatedAt)) || cmp(String(b.id), String(a.id)));
      const q = (opts.q || '').toLowerCase();
      const c = opts.cursor;
      return rows.filter(r => !q || (r.title + ' ' + r.composer + ' ' + r.ownerName).toLowerCase().indexOf(q) > -1)
        .filter(r => !opts.genre || (r.genre || '') === opts.genre)
        .filter(r => !c || String(r.updatedAt) < c.t || (String(r.updatedAt) === c.t && String(r.id) < c.id))
        .slice(0, opts.limit);
    },
    /* the genres that have a listed score, for the page's filter chips */
    async shareGenres() {
      const nowMs = Date.now();
      return Array.from(new Set(loadShares().filter(r => r.listed && r.genre && !guestShare.expired(r, nowMs)).map(r => r.genre))).sort();
    },
    async getShare(id) {
      return loadShares().find(r => r.id === id) || null;
    },
    async findShare(ownerId, songKey) {
      return loadShares().find(r => r.ownerId === ownerId && r.songKey === songKey) || null;
    },
    async countShares(ownerId) {
      return loadShares().filter(r => r.ownerId === ownerId).length;
    },
    async putShare(row) {
      const rows = loadShares().filter(r => r.id !== row.id);
      rows.push(row);
      saveShares(rows);
      return row;
    },
    async deleteShare(id) {
      saveShares(loadShares().filter(r => r.id !== id));
    },
    /* guest links past their end date */
    async deleteExpiredShares(nowMs) {
      const rows = loadShares();
      const keep = rows.filter(r => !guestShare.expired(r, nowMs));
      if (keep.length !== rows.length) saveShares(keep);
      return rows.length - keep.length;
    },
    /* Make or replace a guest's link, or refuse it. Everything from "what is held" to "written" happens in one turn of
       the event loop, so guests take turns: the caps cannot be raced. build(prev) returns the row. */
    async guestUpsert(ownerId, songKey, build, nowMs) {
      let rows = loadShares();
      const live = rows.filter(r => !guestShare.expired(r, nowMs));
      const swept = live.length !== rows.length;
      rows = live;
      const prev = rows.find(r => r.ownerId === ownerId && r.songKey === songKey) || null;
      const guests = rows.filter(r => guestShare.isGuestOwner(r.ownerId));
      const held = guestHeld(guests, ownerId);
      const row = build(prev);
      /* build may refuse by itself (the day's places of a post are taken inside this turn) */
      if (row && row.refuse) { if (swept) saveShares(rows); return { refuse: row.refuse }; }
      const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, row.listed ? guestListing(guests, ownerId, row.addrTag) : null);
      if (refuse) { if (swept) saveShares(rows); return { refuse: refuse }; }
      rows = rows.filter(r => r.id !== row.id);
      rows.push(row);
      saveShares(rows);
      return { row: row, created: !prev };
    },
    /* A guest's own row put into the public list, or taken out of it, in one turn of the event loop like guestUpsert (the caps cannot be raced). Resolves
       { gone } (not theirs, or past its end date), { refuse }, or { row, changed }. A post put back is held to the caps of a new post and renewed to 90 days;
       one taken down keeps its end date and loses its address tag. */
    async guestSetListed(ownerId, id, listed, addrTag, nowMs) {
      let rows = loadShares();
      const live = rows.filter(r => !guestShare.expired(r, nowMs));
      const swept = live.length !== rows.length;
      rows = live;
      const prev = rows.find(r => r.id === id && r.ownerId === ownerId) || null;
      if (!prev) { if (swept) saveShares(rows); return { gone: true }; }
      if (!!prev.listed === !!listed) { if (swept) saveShares(rows); return { row: prev, changed: false }; }
      const row = Object.assign({}, prev, { listed: !!listed, updatedAt: new Date(nowMs).toISOString() });
      if (listed) {
        const guests = rows.filter(r => guestShare.isGuestOwner(r.ownerId));
        const held = guestHeld(guests, ownerId);
        row.addrTag = addrTag || null;
        row.expiresAt = laterIso(prev.expiresAt, guestShare.expiryFor(nowMs, true));
        const refuse = guestShare.decide(prev, held.mine, held.usage, prev.bytes || 0, guestListing(guests, ownerId, row.addrTag));
        if (refuse) { if (swept) saveShares(rows); return { refuse: refuse }; }
      } else row.addrTag = null;
      rows = rows.filter(r => r.id !== id);
      rows.push(row);
      saveShares(rows);
      return { row: row, changed: true };
    }
  };
  /* what the guests hold (the guest rows in `guests`): how many rows and bytes in all, and how many of one owner's */
  function guestHeld(guests, ownerId) {
    return {
      mine: guests.filter(r => r.ownerId === ownerId).length,
      usage: { count: guests.length, bytes: guests.reduce((n, r) => n + (r.bytes != null ? r.bytes : guestShare.rowBytes(r.score, r.preview)), 0) }
    };
  }
  /* the posts held now: of this owner, of this address tag, in all, and their bytes (the argument of share-guest.js decide) */
  function guestListing(guests, ownerId, addrTag) {
    const posts = guests.filter(r => r.listed);
    return {
      ownerListed: posts.filter(r => r.ownerId === ownerId).length,
      addrListed: addrTag ? posts.filter(r => r.addrTag === addrTag).length : 0,
      totalListed: posts.length,
      totalListedBytes: posts.reduce((n, r) => n + (r.bytes != null ? r.bytes : guestShare.rowBytes(r.score, r.preview)), 0)
    };
  }
  function loadShares() {
    try { return JSON.parse(fs.readFileSync(sharesFile, 'utf8')).shares || []; }
    catch (e) { return []; }
  }
  function saveShares(rows) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sharesFile, JSON.stringify({ shares: rows }));
  }
}

function postgresStore(url) {
  let pool = null;
  function getPool() {
    if (!pool) {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: url,
        ssl: /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
        max: 5
      });
      /* a backend that goes away while idle (a restart, a killed session) must not take the server down */
      pool.on('error', e => logStoreError(e, 'idle'));
    }
    return pool;
  }
  async function q(sql, params) {
    return getPool().query(sql, params);
  }
  /* G13-S0: the song-library store's queries have a time-out. node-pg drops the connection of a query that does not answer in query_timeout and fails the query, so a hung
     connection ends one request with a 503 (and the next read of the libraries), instead of holding the library's one writer for ever. Only these queries have it: nothing
     else of the site is changed. PPP_SYNC_QUERY_MS (10 s; 1 s at least) is for a slower database. */
  const SYNC_QUERY_MS = Math.max(1000, parseInt(process.env.PPP_SYNC_QUERY_MS, 10) || 10000);
  async function qs(sql, params) {
    return getPool().query({ text: sql, values: params, query_timeout: SYNC_QUERY_MS });
  }
  const INSERT_SHARE = `INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, composer, genre, kind, measures, listed, preview, score, created_at, updated_at, expires_at, bytes, addr_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO UPDATE SET owner_name = EXCLUDED.owner_name, title = EXCLUDED.title,
           composer = EXCLUDED.composer, genre = EXCLUDED.genre, kind = EXCLUDED.kind, measures = EXCLUDED.measures,
           listed = EXCLUDED.listed, preview = EXCLUDED.preview, score = EXCLUDED.score,
           updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at, bytes = EXCLUDED.bytes, addr_tag = EXCLUDED.addr_tag`;
  const shareParams = row => [row.id, row.ownerId, row.ownerName, row.songKey, row.title, row.composer, row.genre || '', row.kind,
    row.measures, row.listed, row.preview == null ? null : JSON.stringify(row.preview), JSON.stringify(row.score),
    row.createdAt, row.updatedAt, row.expiresAt || null, row.bytes || 0, row.addrTag || null];
  return {
    jobStore: homeJobsStore.pgJobStore(q),
    syncStore: SYNC_ON ? syncStoreMod.pgSyncStore(qs) : null,
    async ready() {
      /* the whole schema work of a boot - this SQL, then the home-PC queue's two tables - runs in one transaction under an advisory lock (home-jobs-store.js): two
         instances booting together take turns instead of racing or deadlocking. This SQL is fatal when it fails, as it always was; the queue's tables are
         optional (a failure there is undone on its own, the rest is committed, and the queue is switched off below). */
      const migrated = await homeJobsStore.migrate(getPool(), `
        CREATE TABLE IF NOT EXISTS ppp_users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        /* G13-5: the keyed hash of the address an account was made from (the signup limit counts by it); NULL for older accounts and the library's own. Additive: the code before this boots on it. */
        ALTER TABLE ppp_users ADD COLUMN IF NOT EXISTS created_ip_tag TEXT;
        CREATE TABLE IF NOT EXISTS ppp_progress (
          user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ppp_shares (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_name TEXT NOT NULL,
          song_key TEXT NOT NULL,
          title TEXT NOT NULL,
          composer TEXT NOT NULL DEFAULT '',
          genre TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          measures INTEGER NOT NULL DEFAULT 0,
          listed BOOLEAN NOT NULL DEFAULT false,
          preview JSONB,
          score JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ppp_shares_listed ON ppp_shares (listed, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS ppp_shares_owner_song ON ppp_shares (owner_id, song_key);
        ALTER TABLE ppp_shares ADD COLUMN IF NOT EXISTS genre TEXT NOT NULL DEFAULT '';
        ALTER TABLE ppp_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
        ALTER TABLE ppp_shares ADD COLUMN IF NOT EXISTS bytes INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS ppp_shares_expires ON ppp_shares (expires_at) WHERE expires_at IS NOT NULL;
        /* G13 (no login anywhere): the keyed hash of the address a LISTED guest post was made from (the cap per address counts by it, and the owner's read-only look at growth lists it).
           NULL on everything else; cleared when the post is taken down; gone with its row at the end date. Additive: the code before this boots on it. */
        ALTER TABLE ppp_shares ADD COLUMN IF NOT EXISTS addr_tag TEXT;
        CREATE INDEX IF NOT EXISTS ppp_shares_addr ON ppp_shares (addr_tag) WHERE addr_tag IS NOT NULL;
        /* A guest's links belong to 'g_' + a hash, not to a user row: drop the foreign key on owner_id that an
           earlier version made (whatever it was named, and only that one). Idempotent. Deleting an account
           therefore no longer deletes its shares by itself: whoever deletes accounts must delete them too. */
        DO $$ DECLARE c text; BEGIN
          FOR c IN SELECT k.conname FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
                   WHERE k.conrelid = 'ppp_shares'::regclass AND k.contype = 'f' AND a.attname = 'owner_id' LOOP
            EXECUTE format('ALTER TABLE ppp_shares DROP CONSTRAINT IF EXISTS %I', c);
          END LOOP;
        END $$;
      `);
      /* (G10b-1 / G10b-2: the queue's tables are the last part of that same migration: CREATE ... IF NOT EXISTS, and one DO block that drops the foreign key of the PR 178 tables
         to ppp_users; nothing is dropped or removed, so the code of PR 178 still boots on the result - rolling back means deploying it again) */
      if (!migrated.queue) {
        const e0 = migrated.error || {};
        const why = String(e0.code || e0.name || 'error') + ' ' + String(e0.message || '').split(/\r?\n/)[0].replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://...').slice(0, 160);
        console.error('Home-PC worker queue: OFF - its tables could not be created (' + why.trim() + '). Everything else is running; /api/jobs and /api/worker answer 503 until this is fixed and the server restarts.');
        jobsService.disable(why);
      }
      /* G13-S0: the sync tables, in a transaction of their own under their own advisory lock (sync-store.js migrate), only when the feature is on; a failure switches the feature
         off and leaves the site as it was (the same rule as the queue's), a lost connection is fatal as the boot's */
      if (SYNC_ON) {
        const sm = await syncStoreMod.migrate(getPool());
        if (!sm.ok) {
          const e1 = sm.error || {};
          const why1 = String(e1.code || e1.name || 'error') + ' ' + String(e1.message || '').split(/\r?\n/)[0].replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://...').slice(0, 160);
          console.error('Song sync: OFF - its tables could not be created (' + why1.trim() + '). Everything else is running; the sync routes answer 503 until this is fixed and the server restarts.');
          syncService.disable(why1);
        }
      }
    },
    async findByEmail(email) {
      const r = await q('SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash" FROM ppp_users WHERE email = $1', [email]);
      return r.rows[0] || null;
    },
    async findById(id) {
      const r = await q('SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash" FROM ppp_users WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async createUser(user) {
      try {
        await q(
          'INSERT INTO ppp_users (id, email, display_name, password_hash, created_ip_tag, created_at) VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))',
          [user.id, user.email, user.displayName, user.passwordHash, user.ipTag || null, user.ipTag ? user.createdAt || null : null]
        );
        return user;
      } catch (e) {
        if (e && e.code === '23505') { const err = new Error('exists'); err.code = 'exists'; throw err; }
        throw e;
      }
    },
    /* accounts made through the signup route lately, for its limit (the library's own account has no tag and is not counted) */
    async countSignups(tag, nowMs) {
      const r = await q('SELECT count(*) FILTER (WHERE created_at > $1)::int AS "siteHour", '
        + 'count(*) FILTER (WHERE created_ip_tag = $3 AND created_at > $1)::int AS "addrHour", '
        + 'count(*) FILTER (WHERE created_ip_tag = $3)::int AS "addrDay" '
        + 'FROM ppp_users WHERE created_ip_tag IS NOT NULL AND created_at > $2',
        [new Date(nowMs - SIGNUP.HOUR_MS).toISOString(), new Date(nowMs - SIGNUP.DAY_MS).toISOString(), tag]);
      return r.rows[0];
    },
    async purgeSignupTags(nowMs) {
      const r = await q('UPDATE ppp_users SET created_ip_tag = NULL WHERE created_ip_tag IS NOT NULL AND created_at < $1', [new Date(nowMs - 2 * SIGNUP.DAY_MS).toISOString()]);
      return r.rowCount || 0;
    },
    async getProgress(userId) {
      const r = await q('SELECT payload, updated_at AS "updatedAt" FROM ppp_progress WHERE user_id = $1', [userId]);
      return r.rows[0] || null;
    },
    async putProgress(userId, payload) {
      await q(
        `INSERT INTO ppp_progress (user_id, payload, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [userId, payload]
      );
    },
    async listShares(opts) {
      const where = [], params = [];
      /* ownerIds: everything these owners hold (an account's and this browser's guest key's), listed or not; else the listed ones. A guest row past its end date is in no list. */
      const owners = opts.ownerIds || (opts.ownerId ? [opts.ownerId] : null);
      if (owners) { params.push(owners); where.push('owner_id = ANY($' + params.length + ')'); }
      else where.push('listed');
      where.push('(expires_at IS NULL OR expires_at > now())');
      if (opts.q) {
        params.push('%' + opts.q.replace(/[\\%_]/g, '\\$&') + '%');
        where.push("(title || ' ' || composer || ' ' || owner_name) ILIKE $" + params.length);
      }
      if (opts.genre) { params.push(opts.genre); where.push('genre = $' + params.length); }
      /* the cursor carries milliseconds (a JS Date), so the order is at milliseconds too: a row with microseconds is never skipped or shown twice */
      const ms = "date_trunc('milliseconds', updated_at)";
      if (opts.cursor) {
        params.push(opts.cursor.t, opts.cursor.id);
        where.push('(' + ms + ' < $' + (params.length - 1) + ' OR (' + ms + ' = $' + (params.length - 1) + ' AND id < $' + params.length + '))');
      }
      params.push(opts.limit);
      const r = await q('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE ' + where.join(' AND ')
        + ' ORDER BY ' + ms + ' DESC, id DESC LIMIT $' + params.length, params);
      return r.rows;
    },
    async shareGenres() {
      const r = await q("SELECT DISTINCT genre FROM ppp_shares WHERE listed AND genre <> '' AND (expires_at IS NULL OR expires_at > now()) ORDER BY genre");
      return r.rows.map(x => x.genre);
    },
    async getShare(id) {
      const r = await q('SELECT ' + SHARE_COLS + ', score FROM ppp_shares WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async findShare(ownerId, songKey) {
      const r = await q('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE owner_id = $1 AND song_key = $2', [ownerId, songKey]);
      return r.rows[0] || null;
    },
    async countShares(ownerId) {
      const r = await q('SELECT count(*)::int AS n FROM ppp_shares WHERE owner_id = $1', [ownerId]);
      return r.rows[0].n;
    },
    async putShare(row) {
      await q(INSERT_SHARE, shareParams(row));
      return row;
    },
    async deleteShare(id) {
      await q('DELETE FROM ppp_shares WHERE id = $1', [id]);
    },
    async deleteExpiredShares(nowMs) {
      const r = await q('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL AND expires_at <= $1', [new Date(nowMs).toISOString()]);
      return r.rowCount || 0;
    },
    /* Make or replace a guest's link, or refuse it: one transaction under an advisory lock, so guests take turns
       and the caps (per browser, count, bytes) cannot be raced. build(prev) returns the row. */
    async guestUpsert(ownerId, songKey, build, nowMs) {
      const c = await getPool().connect();
      /* an error on a checked-out connection (its backend was killed) is an event, and an unhandled one ends the process */
      let broken = false;
      const onError = e => { broken = true; logStoreError(e); };
      c.on('error', onError);
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock($1)', [GUEST_LOCK_KEY]);
        await c.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL AND expires_at <= $1', [new Date(nowMs).toISOString()]);
        const prev = (await c.query('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE owner_id = $1 AND song_key = $2', [ownerId, songKey])).rows[0] || null;
        const row = build(prev);
        /* build may refuse by itself (the day's places of a post are taken inside this turn) */
        if (row && row.refuse) { await c.query('COMMIT'); return { refuse: row.refuse }; }
        const held = await pgHeld(c, ownerId, row.addrTag);
        const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, row.listed ? held.listing : null);
        if (refuse) { await c.query('COMMIT'); return { refuse: refuse }; }
        await c.query(INSERT_SHARE, shareParams(row));
        await c.query('COMMIT');
        return { row: row, created: !prev };
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch (e2) { broken = true; /* the connection is gone */ }
        throw e;
      } finally {
        c.removeListener('error', onError);
        /* a connection that errored is destroyed, not handed to the next request */
        c.release(broken || undefined);
      }
    },
    /* A guest's own row put into the public list, or taken out of it: the same transaction and lock as guestUpsert. Resolves { gone } (not theirs, or past its end
       date), { refuse }, or { row, changed }. A post put back is held to the caps of a new post and renewed to 90 days; one taken down keeps its end date and loses its
       address tag. */
    async guestSetListed(ownerId, id, listed, addrTag, nowMs) {
      const c = await getPool().connect();
      let broken = false;
      const onError = e => { broken = true; logStoreError(e); };
      c.on('error', onError);
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock($1)', [GUEST_LOCK_KEY]);
        await c.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL AND expires_at <= $1', [new Date(nowMs).toISOString()]);
        const prev = (await c.query('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE id = $1 AND owner_id = $2', [id, ownerId])).rows[0] || null;
        if (!prev) { await c.query('COMMIT'); return { gone: true }; }
        if (!!prev.listed === !!listed) { await c.query('COMMIT'); return { row: prev, changed: false }; }
        const row = Object.assign({}, prev, { listed: !!listed, updatedAt: new Date(nowMs).toISOString(), addrTag: null });
        if (listed) {
          const held = await pgHeld(c, ownerId, addrTag);
          row.addrTag = addrTag || null;
          row.expiresAt = laterIso(prev.expiresAt, guestShare.expiryFor(nowMs, true));
          const refuse = guestShare.decide(prev, held.mine, held.usage, Number(prev.bytes) || 0, held.listing);
          if (refuse) { await c.query('COMMIT'); return { refuse: refuse }; }
        }
        await c.query('UPDATE ppp_shares SET listed = $2, updated_at = $3, addr_tag = $4, expires_at = $5 WHERE id = $1',
          [id, row.listed, row.updatedAt, row.addrTag, row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt]);
        await c.query('COMMIT');
        return { row: row, changed: true };
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch (e2) { broken = true; /* the connection is gone */ }
        throw e;
      } finally {
        c.removeListener('error', onError);
        c.release(broken || undefined);
      }
    }
  };
  /* What the guests hold, counted inside the store's transaction (`c` is its connection; the rows with an end date are the guests'): rows and bytes in all, this owner's
     rows, and the posts (listed guest rows): in all, their bytes, this owner's, this address tag's. The argument of share-guest.js decide. */
  async function pgHeld(c, ownerId, addrTag) {
    const r = (await c.query('SELECT count(*)::int AS n, coalesce(sum(bytes), 0)::float8 AS bytes, '
      + 'count(*) FILTER (WHERE owner_id = $1)::int AS mine, '
      + 'count(*) FILTER (WHERE listed)::int AS "postN", coalesce(sum(bytes) FILTER (WHERE listed), 0)::float8 AS "postBytes", '
      + 'count(*) FILTER (WHERE listed AND owner_id = $1)::int AS "postMine", '
      + 'count(*) FILTER (WHERE listed AND addr_tag = $2)::int AS "postAddr" '
      + 'FROM ppp_shares WHERE expires_at IS NOT NULL', [ownerId, addrTag || null])).rows[0];
    return {
      mine: r.mine, usage: { count: r.n, bytes: Number(r.bytes) },
      listing: { ownerListed: r.postMine, addrListed: addrTag ? r.postAddr : 0, totalListed: r.postN, totalListedBytes: Number(r.postBytes) }
    };
  }
}

const SHARE_COLS = 'id, owner_id AS "ownerId", owner_name AS "ownerName", song_key AS "songKey", title, composer, genre, kind, '
  + 'measures, listed, preview, created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt", bytes, addr_tag AS "addrTag"';

const store = process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL) : fileStore();

/* G10b-1: ONE instance holds the queue in memory (home-jobs.js says why); the database is only its durable copy. G10b-2: no account, no session: ipSecret keys the hash of the
   address a PC link was made from (the address itself is never kept) */
const jobsService = homeJobs.create({
  store: store.jobStore, send: send, jsonError: jsonError, parseYoutube: parseYoutubeWatch,
  clientIp: guestShare.clientIp, ipSecret: SECRET, logError: logStoreError,
  warn: w => console.warn('Home-PC worker queue: ' + w)
});

/* G13-S0: the song libraries (sync.js). One instance holds them in memory, like the queue; the database is the durable copy. Its numbers go into the hourly stats line. */
const syncService = SYNC_ON ? require('./sync').create({
  store: store.syncStore, send: send, jsonError: jsonError, clientIp: guestShare.clientIp, ipSecret: SECRET, logError: logStoreError
}) : null;
if (syncService) serverStats.addGauge('sync', syncService.gauge);

/* ---- the seed library ----
   One score per genre, so Shared Scores is never an empty shelf and every
   genre chip has something behind it. They are ordinary listed shares owned
   by a library account that cannot sign in; the file in catalog/ is built by
   catalog/build-shared-seeds.js from public-domain scores and short pieces
   written for PPP. Adding or editing a seed needs no schema change and no
   migration: an id that is already there is left exactly as it is. */
const SEED_OWNER = { id: 'ppp-library', name: 'PPP Library', email: 'library@ppp.local' };
async function seedSharedScores() {
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'shared-seeds.json'), 'utf8')); }
  catch (e) { return; }
  const seeds = (doc && doc.seeds) || [];
  if (!seeds.length) return;
  const owner = Object.assign({}, SEED_OWNER, doc.owner || {});
  let user = null;
  try { user = await store.findByEmail(owner.email); } catch (e) { user = null; }
  if (!user) {
    try {
      await store.createUser({
        id: owner.id, email: owner.email, displayName: owner.name,
        passwordHash: 'no-sign-in', createdAt: new Date().toISOString()
      });
    } catch (e) {
      if (e && e.code !== 'exists') throw e;
    }
    user = await store.findByEmail(owner.email);
  }
  if (!user) return;
  const now = new Date().toISOString();
  for (const s of seeds) {
    if (!s || !s.id || !validScore(s.score)) continue;
    const have = await store.getShare(s.id);
    if (have) continue;
    await store.putShare({
      id: s.id, ownerId: user.id, ownerName: owner.name, songKey: s.songKey || ('seed:' + s.id),
      title: clipText(s.title, 120), composer: clipText(s.composer, 160), genre: clipText(s.genre, 32),
      kind: clipText(s.kind || 'seed', 24), measures: s.score.measures.length,
      listed: true, preview: s.preview || null, score: s.score,
      createdAt: now, updatedAt: now
    });
    console.log('Seeded shared score: ' + s.genre + ' — ' + s.title);
  }
}

async function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  const sess = readSession(token);
  if (!sess) return null;
  return store.findById(sess.uid);
}

function safePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { return null; }
  if (decoded !== '/' && decoded.indexOf('/.') > -1) return null;
  const rel = decoded === '/' ? '' : decoded.replace(/^\/+/, '');
  const top = rel.split(/[\\/]/)[0];
  if (BLOCKED.has(top)) return null;
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && abs.indexOf(ROOT + path.sep) !== 0) return null;
  return abs;
}

/* A file that exists and is not on the served list is either a probe (/server.js, /package.json) or a file the page needs that the list forgot. The second is what
   to read in the log after a deploy, so the first 40 distinct such paths are named, once each. */
const notServedSeen = new Set();
function noteNotServed(abs, rel) {
  if (notServedSeen.size >= 40 || notServedSeen.has(rel) || rel.indexOf('\0') >= 0) return;
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile() || notServedSeen.size >= 40 || notServedSeen.has(rel)) return;
    notServedSeen.add(rel);
    console.warn('Static: ' + JSON.stringify(rel.replace(/[^ -~]/g, '?').slice(0, 120)) + ' is a file of this site that is not on the served list (static-allow.js): answered 404.');
  });
}

const BUILD_ID = String(process.env.RENDER_GIT_COMMIT || process.env.PPP_BUILD || '').replace(/[^0-9a-f]/gi, '').slice(0, 7);
const APP_FILE = 'Piano Coach App.dc.html';
/* the page, at / and at its own address: the share's tags, the build stamp, and (G13-4c) the content hash of every script, catalog and font it loads */
async function servePage(req, res, url) {
  let text = fs.readFileSync(path.join(ROOT, APP_FILE)).toString('utf8');
  const meta = await shareMeta(url && url.searchParams.get('share'), req);
  /* after the charset, which has to come first */
  if (meta) text = /<meta charset="utf-8">/i.test(text) ? text.replace(/<meta charset="utf-8">/i, m => m + '\n' + meta) : text.replace(/<head>/i, m => m + '\n' + meta);
  if (BUILD_ID) {
    /* the commit this server runs, for the page to stamp on what it makes (and for a person to read): Render sets RENDER_GIT_COMMIT */
    const tag = '<script>window.PPP_BUILD=' + JSON.stringify(BUILD_ID) + ';</script>';
    text = /<meta charset="utf-8">/i.test(text) ? text.replace(/<meta charset="utf-8">/i, m => m + '\n' + tag) : text.replace(/<head>/i, m => m + '\n' + tag);
  }
  text = assets.preparePage(text, ROOT);
  const body = Buffer.from(text, 'utf8');
  /* G13-4c3: the page is revalidated, not stored for nothing. The browser keeps it (it must ask before it uses it: no-cache) with the tag of its bytes, and a visit
     that finds the same bytes - same build, same hashes - is answered 304 with no body: a returning visitor no longer downloads the 306 KB page again. The tag is of the
     bytes sent (the share's tags and the build stamp are in them), so a deploy, a changed script (its hash is in the page) or another ?share= is another tag: nothing
     stale can be shown. */
  const etag = '"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 20) + '"';
  const headers = { 'Cache-Control': 'no-cache', 'ETag': etag };
  if (assets.ifNoneMatchHas(req.headers['if-none-match'], etag)) return send(res, 304, Buffer.alloc(0), headers);
  headers['Content-Type'] = 'text/html; charset=utf-8';
  send(res, 200, body, headers);
}
async function serveStatic(req, res, urlPath, url) {
  if (urlPath === '/' || urlPath === '/index.html') return servePage(req, res, url);
  const abs = safePath(urlPath);
  if (!abs) return jsonError(res, 404, 'Not found');
  /* the file this request resolves to, from the root with "/" (not the text of the request: "//a", "%2e" and a disk that ignores case all land on it) */
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!staticAllow.isServed(rel)) { noteNotServed(abs, rel); return jsonError(res, 404, 'Not found'); }
  if (rel === APP_FILE) return servePage(req, res, url);
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return jsonError(res, 404, 'Not found');
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    /* the piano recordings never change once shipped, and are the heaviest thing here */
    const cache = ext === '.html' || ext === '.js' || ext === '.json' ? 'no-store'
      : ext === '.mp3' ? 'public, max-age=2592000' : 'public, max-age=3600';
    fs.readFile(abs, (e2, buf) => {
      if (e2) return jsonError(res, 500, 'Read failed');
      const want = assets.HASHABLE.has(ext) && url ? assets.hashOfRequest(url.searchParams) : null;
      if (want) {
        const e = assets.entryOf(abs, st, buf);
        if (e.hash === want) {
          return assets.immutableAnswer(req, e, buf, type).then(a => send(res, a.status, a.body, a.headers), err2 => {
            console.error(err2);
            if (!res.headersSent) jsonError(res, 500, 'Server error');
          });
        }
      }
      send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': cache });
    });
  });
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function tooMany(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip) || { n: 0, t: now };
  if (now - row.t > LOGIN_WINDOW_MS) { row.n = 0; row.t = now; }
  row.n += 1;
  loginAttempts.set(ip, row);
  return row.n > 40;
}

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  if (p === '/health' || p === '/api/health') {
    send(res, 200, { ok: true, service: 'ppp' });
    return;
  }

  /* G13-7b (U5): the page's anonymous counters (a beacon: its answer is never read). A POST from this site only (an Origin that is another site's is refused), at most STATS_PER_WINDOW from one address
     in ten minutes, a body of at most 1 KB whose structure is bounded as it arrives; client-stats.js takes the whitelisted keys and the numbers capped, serverStats adds them up. No cookie is read or
     set, nothing is stored, and the answer is 204 with no body (or an error that says nothing about the counters). */
  if (method === 'POST' && p === '/api/stats') {
    const quiet = { 'Cache-Control': 'no-store' };
    const origin = req.headers.origin;
    if (origin) {
      let same = false;
      try { same = new URL(String(origin)).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch (e) { same = false; }
      if (!same) return send(res, 403, { error: 'Not allowed.' }, quiet);
    }
    const who = guestShare.clientAddress(req);
    const local = who.source === 'socket' && signupLimit.LOOPBACK.test(who.ip);
    if (!local && !statsBeacons.take(statsTagOf(who.ip))) {
      return send(res, 429, { error: 'Too many.', code: 'too-many' }, { 'Cache-Control': 'no-store', 'Retry-After': String(STATS_WINDOW_MS / 1000) });
    }
    let parsed;
    try { parsed = JSON.parse((await readBody(req, clientStats.MAX_BODY, 8 * 1024, STATS_SHAPE)).toString('utf8') || 'null'); }
    catch (e) { return send(res, e && e.code === 'TOO_LARGE' ? 413 : 400, { error: e && e.code === 'TOO_LARGE' ? 'Too large.' : 'Invalid body.' }, quiet); }
    const r = clientStats.sanitize(parsed);
    if (!r.ok) return send(res, 400, { error: 'Invalid body.' }, quiet);
    serverStats.clientBeacon(r.doc, !!(BUILD_ID && r.doc.b && r.doc.b.slice(0, BUILD_ID.length) !== BUILD_ID));
    return send(res, 204, '', quiet);
  }

  if (method === 'GET' && p === '/api/youtube-title') {
    const parsed = parseYoutubeWatch(url.searchParams.get('url'));
    if (!parsed) return jsonError(res, 422, 'Not a YouTube video.');
    const watch = parsed.url;
    const oembed = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watch);
    const title = await new Promise(resolve => {
      const req2 = https.get(oembed, { timeout: 8000, headers: { 'User-Agent': 'PPP/1' } }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve((JSON.parse(d) || {}).title || null); } catch (e) { resolve(null); }
        });
      });
      req2.on('error', () => resolve(null));
      req2.on('timeout', () => { req2.destroy(); resolve(null); });
    });
    send(res, 200, { title: title }, { 'Cache-Control': 'no-store' });
    return;
  }

  if (method === 'GET' && p === '/api/youtube-audio') {
    const parsed = parseYoutubeWatch(url.searchParams.get('url'));
    if (!parsed) return jsonError(res, 422, 'Not a YouTube video.', { code: 'bad-url' });
    let got = null;
    try {
      got = await fetchYoutubeAudioFile(parsed);
    } catch (e) {
      got = { file: null, dir: null, tail: String(e && e.message || '') };
    }
    if (!got || !got.file) {
      if (got && got.dir) rmDir(got.dir);
      return jsonError(res, 502, 'The audio could not be downloaded from that link.', { code: 'download-failed' });
    }
    pipeAudioFile(res, got.file, got.dir);
    return;
  }

  if (method === 'POST' && p === '/api/auth/signup') {
    /* G13-5 (TD26): see SIGNUP. The requests are counted before the body is read; the accounts made lately, before the password is hashed. */
    const who = guestShare.clientAddress(req);
    const local = who.source === 'socket' && signupLimit.LOOPBACK.test(who.ip);
    const tag = signupTagOf(who.ip);
    /* a limiter's refusal: 429 with code 'too-many' (the page shows it and stops; any other 429 it takes for a busy edge and tries again) and how long to wait at most */
    const refuse = (message, reason) => send(res, 429, { error: message, code: 'too-many' }, { 'Retry-After': String(signupLimit.retryAfter(reason)) });
    if (!local && !signupAttempts.take(tag)) return refuse('Too many attempts. Try again later.', 'attempts');
    let body;
    try { body = JSON.parse((await readBody(req, SMALL_BODY_BYTES, undefined, bodyReader.SMALL_SHAPE)).toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email) return jsonError(res, 422, 'Enter a valid email.');
    if (password.length < 8) return jsonError(res, 422, 'Password must be at least 8 characters.');
    /* One at a time from reading the count to writing the account (signup-limit.js serial): the count is exact, and 16 requests at once make exactly what the cap allows. */
    const out = await signupSerial(async () => {
      let why = null;
      try { why = signupLimit.refusal(await store.countSignups(tag, Date.now()), local); }
      catch (e) { logStoreError(e); return { status: 500 }; }
      if (why) return { why: why };
      const user = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
        email: email,
        displayName: clipName(body.displayName || body.name, email),
        passwordHash: hashPassword(password),
        ipTag: tag,
        createdAt: new Date().toISOString()
      };
      try { await store.createUser(user); }
      catch (e) {
        if (e && e.code === 'exists') return { status: 409 };
        console.error(e);
        return { status: 500 };
      }
      return { user: user };
    });
    if (out.why) {
      return refuse(out.why === 'site' ? 'PPP is making a lot of accounts just now. Try again in a little while.'
        : 'Too many accounts were made from here just now. Try again later.', out.why);
    }
    if (out.status === 409) return jsonError(res, 409, 'An account with this email already exists.');
    if (out.status) return jsonError(res, 500, 'Could not create account.');
    setCookie(res, signSession(out.user.id));
    send(res, 201, publicUser(out.user));
    return;
  }

  if (method === 'POST' && p === '/api/auth/login') {
    const ip = guestShare.clientIp(req);
    /* G13-5b: the same refusal as the signup limiter's (code 'too-many': the page shows it and stops, where any other 429 it takes for a busy edge and tries again), and the longest it can last */
    if (tooMany(ip)) return send(res, 429, { error: 'Too many attempts. Try again later.', code: 'too-many' }, { 'Retry-After': String(LOGIN_WINDOW_MS / 1000) });
    let body;
    try { body = JSON.parse((await readBody(req, SMALL_BODY_BYTES, undefined, bodyReader.SMALL_SHAPE)).toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) return jsonError(res, 422, 'Invalid email or password.');
    const user = await store.findByEmail(email);
    if (!user) return jsonError(res, 401, 'No account with that email. Create one first.');
    if (!verifyPassword(password, user.passwordHash)) {
      return jsonError(res, 401, 'Invalid email or password.');
    }
    setCookie(res, signSession(user.id));
    send(res, 200, publicUser(user));
    return;
  }

  if (method === 'POST' && p === '/api/auth/logout') {
    clearCookie(res);
    send(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && p === '/api/auth/me') {
    const user = await currentUser(req);
    send(res, 200, user ? publicUser(user) : { user: null, guest: true });
    return;
  }

  if (p === '/api/progress') {
    const user = await currentUser(req);
    if (!user) return jsonError(res, 401, 'Authentication required');
    if (method === 'GET') {
      const row = await store.getProgress(user.id);
      send(res, 200, { payload: row ? row.payload : null, updatedAt: row ? row.updatedAt : null });
      return;
    }
    if (method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}'); }
      catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
      await store.putProgress(user.id, body.payload == null ? body : body.payload);
      send(res, 200, { ok: true });
      return;
    }
  }

  if (p === '/api/shares' || p.indexOf('/api/shares/') === 0) {
    return handleShares(req, res, url);
  }

  /* G10b-1 / G10b-2: /api/jobs..., /api/pc-links... (no sign-in: the link's client code is the key) and /api/worker/... for the worker script on the person's own PC */
  if (jobsService.owns(p)) return jobsService.handle(req, res, url);

  /* G13-S0: /api/libs..., /api/sync/... (only with PPP_SYNC=1; without it these are unknown paths: the 404 below) */
  if (syncService && syncService.owns(p)) return syncService.handle(req, res, url);

  jsonError(res, 404, 'Not found');
}

async function handleShares(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const user = await currentUser(req);
  /* A guest key, when the request carries one that is a key at all. It never stands in for an account. */
  const guestHeader = req.headers[GUEST.HEADER];
  const guestId = guestShare.guestOwnerId(typeof guestHeader === 'string' ? guestHeader : '');
  const viewer = user || guestId ? { id: user ? user.id : guestId, guestId: guestId } : null;
  const nowMs = Date.now();

  if (p === '/api/shares' && method === 'GET') {
    const mine = url.searchParams.get('mine') === '1';
    /* yours: what the account holds and what this browser's guest key holds (a person who signed in later still sees their guest posts) */
    if (mine && !user && !guestId) return jsonError(res, 401, 'This browser has no sharing key yet: nothing is shared from it.');
    const asked = parseInt(url.searchParams.get('limit'), 10);
    const limit = asked > 0 ? Math.min(asked, mine ? SHARE_LIST_LIMIT : SHARE_PAGE_MAX) : mine ? SHARE_LIST_LIMIT : SHARE_PAGE;
    const cursorText = url.searchParams.get('cursor');
    const cursor = cursorText ? readShareCursor(cursorText) : null;
    if (cursorText && !cursor) return jsonError(res, 400, 'That page marker is not one PPP gave.');
    /* one more than a page, to know whether there is a next one */
    /* a NUL cannot be stored or compared in Postgres text: it is no part of a search */
    const plain = (v, n) => clipText(v, n).replace(/\u0000/g, '');
    const rows = await store.listShares({
      ownerIds: mine ? [user && user.id, guestId].filter(Boolean) : null,
      q: plain(url.searchParams.get('q'), 80),
      genre: plain(url.searchParams.get('genre'), 32),
      cursor: cursor,
      limit: limit + 1
    });
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const out = { shares: page.map(r => shareCard(r, viewer)), next: more ? shareCursorOf(page[page.length - 1]) : null };
    if (!mine && !cursor) out.genres = await store.shareGenres();
    send(res, 200, out, { 'Cache-Control': 'no-store' });
    return;
  }

  if (p === '/api/shares' && method === 'POST') {
    if (!user && !guestId) return jsonError(res, 401, 'This browser did not send its sharing key. Reload the page and try again.');
    /* no account: an unlisted link only. The public write is rationed before the body is read (is there room
       left for this address and for the server?), counted once the request proves to be a real share, and
       requests that fail validation get a small budget of their own, so they are neither free nor able to
       burn the budget honest guests share. */
    const guest = !user;
    let ip = null;
    if (guest) {
      const who = guestShare.clientAddress(req);
      ip = homeJobs.addrKey(who.ip || 'unknown');
      if (!guestSourceLogged) { guestSourceLogged = true; console.log('Guest links: the first request named its client from ' + who.source); }
      if (!guestLimits.ip.peek(ip) || !guestLimits.fails.peek(ip) || !guestLimits.all.peek('all')) {
        return jsonError(res, 429, 'Too many links were made from here just now. Try again in a little while.');
      }
    }
    const refuse = (status, message, extra) => {
      if (guest) guestLimits.fails.take(ip);
      return jsonError(res, status, message, extra);
    };
    let raw, body;
    try { raw = await readBody(req, guest ? GUEST.MAX_BYTES : SHARE_MAX_BYTES, guest ? GUEST_DRAIN_BYTES : undefined); }
    catch (e) {
      /* a structure that cannot be a score (a nesting past 80, a container for every few bytes) is the same 422 as one that parses and is refused below; only a size is a 413 */
      if (e && e.code === 'SHAPE') return refuse(422, 'That is not a score PPP can share.');
      return refuse(413, guest ? GUEST_TOO_BIG : 'That score is too large to share.');
    }
    try { body = JSON.parse(raw.toString('utf8') || '{}'); }
    catch (e) { return refuse(400, 'Invalid JSON'); }
    /* a NUL, a lone surrogate or a nesting of more than 64 cannot be stored (or read back): it is not a score */
    if (!body || typeof body !== 'object' || guestShare.inspect(body)) return refuse(422, 'That is not a score PPP can share.');
    if (!validScore(body.score)) return refuse(422, 'That is not a score PPP can share.');
    const songKey = clipText(body.songKey, 80);
    if (!songKey) return refuse(422, 'That is not a score PPP can share.');
    const title = guestShare.cleanText(body.title || body.score.title, 120);
    if (!title) return refuse(422, 'A shared score needs a title.');
    /* what the score carries in its own title and composer is shown as well (the card of an opened link, the shelf of whoever adds it): the same cleaning, and the staves and
       staff numbers a drawing loops over are bounded (an honest score has 1 to 3 staves) */
    guestShare.cleanScore(body.score);
    /* G13-3: not to the public list - for an account and for a guest alike (a guest is charged for asking, as for any request that cannot be kept). A link (listed left out,
       or false) is not refused. */
    if (body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {
      return refuse(403, YOUTUBE_NOT_PUBLIC, { code: 'youtube-not-public' });
    }
    const ownerId = guest ? guestId : user.id;
    /* the places of the day a post takes (taken inside the store's turn, in buildRow; given back when the store refuses) */
    let postTaken = false;
    const previewMax = guest ? GUEST.PREVIEW_MAX_BYTES : 96 * 1024;
    let preview = null, bytes = 0;
    try {
      /* the preview is DRAWN by the page's engraver: what is stored is rebuilt from what a preview is (4 bars, 400 notes, staves and staff 1..4, every number finite and small),
         not what was sent. Not a preview at all (not an object with bars and notes): 422. Too big once rebuilt: dropped, as before. */
      if (body.preview != null) {
        const np = guestShare.normalizePreview(body.preview, 4);
        if (!np) return refuse(422, 'That is not a score PPP can share.');
        preview = JSON.stringify(np).length < previewMax ? np : null;
      }
      if (guest) bytes = guestShare.rowBytes(body.score, preview);
    } catch (e) {
      /* nested too deep to be written down: not a score */
      if (e instanceof RangeError) return refuse(422, 'That is not a score PPP can share.');
      throw e;
    }
    const buildRow = prev => {
      const now = new Date().toISOString();
      /* sending a link never takes a posted score down, and never posts one (a guest's too); a guest's post is only what the request says, or what it already was */
      const wasListed = !!(prev && prev.listed);
      const listed = typeof body.listed === 'boolean' ? body.listed : wasListed;
      /* a limit is asked only when the row BECOMES listed (a post sent again, or a link re-sent while its post stands, is not a new post: the hourly limits, the size and the
         caps on what is held still hold). Put back the day it was listed, it is the same post: no new place of the day. */
      if (guest && listed && !wasListed) {
        const free = guestShare.recentlyListed(prev, nowMs);
        const why = takeGuestPost(ip, guestId, free);
        if (why) return { refuse: why };
        postTaken = !free;
      }
      const r = {
        id: prev ? prev.id : newShareId(),
        ownerId: ownerId, ownerName: guest ? guestShare.guestName(body.displayName) : user.displayName, songKey: songKey,
        title: title, composer: guestShare.cleanText(body.composer, 160), genre: guest ? '' : guestShare.cleanText(body.genre, 32), kind: guestShare.cleanText(body.kind, 24),
        measures: body.score.measures.length,
        listed: listed,
        preview: preview, score: body.score,
        createdAt: prev ? prev.createdAt : now, updatedAt: now
      };
      if (guest) { r.expiresAt = guestShare.expiryFor(nowMs, listed); r.bytes = bytes; r.addrTag = listed ? guestAddrTagOf(ip) : null; }
      return r;
    };
    const releasePost = () => { if (postTaken) { postTaken = false; releaseGuestPost(ip, guestId); } };

    if (guest) {
      /* this request is a real share now: it counts */
      if (!guestLimits.ip.take(ip)) return jsonError(res, 429, 'Too many links were made from here just now. Try again in a little while.');
      if (!guestLimits.all.take('all')) {
        guestLimits.ip.release(ip);
        return jsonError(res, 429, 'Too many links were made from here just now. Try again in a little while.');
      }
      let out;
      try { out = await store.guestUpsert(ownerId, songKey, buildRow, nowMs); }
      catch (e) {
        /* whatever the store says, this request made nothing: give the budget back, and charge the address */
        guestLimits.ip.release(ip); guestLimits.all.release('all'); releasePost();
        if (e instanceof RangeError) return refuse(422, 'That is not a score PPP can share.');
        guestLimits.fails.take(ip);
        logStoreError(e);
        return jsonError(res, 500, 'Server error');
      }
      if (out.refuse) {
        /* a refused link made nothing: give the budget back, but charge the address for asking */
        guestLimits.ip.release(ip); guestLimits.all.release('all'); releasePost();
        guestLimits.fails.take(ip);
        return jsonError(res, out.refuse.status, out.refuse.error, out.refuse.code ? { code: out.refuse.code } : undefined);
      }
      send(res, out.created ? 201 : 200, Object.assign(shareCard(out.row, viewer), { url: '/?share=' + out.row.id }));
      return;
    }

    let prev, row;
    try {
      prev = await store.findShare(user.id, songKey);
      if (!prev && await store.countShares(user.id) >= SHARES_PER_USER) {
        return jsonError(res, 429, 'You have shared as many scores as PPP keeps for one account.');
      }
      row = buildRow(prev);
      try { await store.putShare(row); }
      catch (e) {
        /* the same song sent twice at once: the second is an update of the first, not an error */
        if (!e || e.code !== '23505') throw e;
        prev = await store.findShare(user.id, songKey);
        if (!prev) throw e;
        row = buildRow(prev);
        await store.putShare(row);
      }
    } catch (e) {
      if (e instanceof RangeError) return jsonError(res, 422, 'That is not a score PPP can share.');
      logStoreError(e);
      return jsonError(res, 500, 'Server error');
    }
    send(res, prev ? 200 : 201, Object.assign(shareCard(row, viewer), { url: '/?share=' + row.id }));
    return;
  }

  const m = /^\/api\/shares\/([\w-]{6,32})$/.exec(p);
  if (!m) return jsonError(res, 404, 'Not found');
  const row = await store.getShare(m[1]);
  if (!row || guestShare.expired(row, nowMs)) return jsonError(res, 404, 'That shared score is no longer there.');

  if (method === 'GET') {
    send(res, 200, Object.assign(shareCard(row, viewer), { score: row.score, url: '/?share=' + row.id }),
      { 'Cache-Control': 'no-store' });
    return;
  }
  /* the account that shared it may change it; so may the guest key that made it (the key's own name, compared as bytes of equal length: a wrong key, no key and a
     row that is someone else's all get the same 403). Nobody else. */
  const userOwns = !!user && user.id === row.ownerId;
  const guestOwns = !!guestId && guestShare.isGuestOwner(row.ownerId) && guestShare.sameOwner(guestId, row.ownerId);
  if (!userOwns && !guestOwns) return jsonError(res, 403, 'Only the person who shared it can change that.');
  if (method === 'PATCH') {
    let body;
    try { body = JSON.parse((await readBody(req, SMALL_BODY_BYTES, undefined, bodyReader.SMALL_SHAPE)).toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    if (typeof body.listed !== 'boolean') return jsonError(res, 422, 'Nothing to change.');
    /* G13-3: posting a stored score that came from a YouTube link is refused like the first post; one already posted stays as it is, and taking down is always allowed */
    if (body.listed === true && !row.listed && youtubeDerivedShare(row.score, false)) {
      return jsonError(res, 403, YOUTUBE_NOT_PUBLIC, { code: 'youtube-not-public' });
    }
    if (!userOwns) {
      /* a guest's own row: put into the public list (rationed like a post: a day's places, and the caps of a new post, inside the store's turn), or taken out of it
         (which costs nothing, and is always allowed) */
      let ip = null, took = false, tag = null;
      if (body.listed === true && !row.listed) {
        ip = guestPlaceOf(req);
        tag = guestAddrTagOf(ip);
        const free = guestShare.recentlyListed(row, Date.now());
        const why = takeGuestPost(ip, guestId, free);
        if (why) return jsonError(res, why.status, why.error, { code: why.code });
        took = !free;
      }
      let out;
      try { out = await store.guestSetListed(guestId, row.id, body.listed, tag, Date.now()); }
      catch (e) {
        if (took) releaseGuestPost(ip, guestId);
        logStoreError(e);
        return jsonError(res, 500, 'Server error');
      }
      if (out.gone) { if (took) releaseGuestPost(ip, guestId); return jsonError(res, 404, 'That shared score is no longer there.'); }
      if (out.refuse) { if (took) releaseGuestPost(ip, guestId); return jsonError(res, out.refuse.status, out.refuse.error, out.refuse.code ? { code: out.refuse.code } : undefined); }
      send(res, 200, Object.assign(shareCard(out.row, viewer), { url: '/?share=' + out.row.id }));
      return;
    }
    row.listed = body.listed;
    row.updatedAt = new Date().toISOString();
    await store.putShare(row);
    send(res, 200, Object.assign(shareCard(row, viewer), { url: '/?share=' + row.id }));
    return;
  }
  if (method === 'DELETE') {
    await store.deleteShare(row.id);
    send(res, 200, { ok: true });
    return;
  }
  jsonError(res, 405, 'Method not allowed');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* A link to a shared score says what it is before it is opened, so a post on
   a social network shows the title rather than the app's name alone. */
async function shareMeta(id, req) {
  if (!/^[\w-]{6,32}$/.test(id || '')) return '';
  let row = null;
  try { row = await store.getShare(id); } catch (e) { row = null; }
  if (!row || guestShare.expired(row, Date.now())) return '';
  const proto = String(req.headers['x-forwarded-proto'] || (COOKIE_SECURE ? 'https' : 'http')).split(',')[0].trim();
  const link = proto + '://' + (req.headers.host || 'localhost') + '/?share=' + encodeURIComponent(row.id);
  /* G13-3 (U9): a score made from a YouTube link is for its owner's practice; its link is for the people it was sent to, as a guest link is: not for a search engine and with
     no title or description of it in a preview (the page's own <title> is all the link says) */
  if (youtubeDerivedShare(row.score, false)) return '<meta name="robots" content="noindex">';
  const title = guestShare.cleanText(row.title, 120) + (row.composer ? ' · ' + guestShare.cleanText(row.composer, 160) : '');
  const desc = row.measures + (row.measures === 1 ? ' bar' : ' bars') + ' · shared by ' + guestShare.cleanText(row.ownerName, 160) + ' on PPP — Piano Practice Partner';
  return [
    /* a guest link is for the people it was sent to, not for a search engine */
    guestShare.isGuestOwner(row.ownerId) ? '<meta name="robots" content="noindex">' : '',
    '<title>' + escapeHtml(title + ' — PPP') + '</title>',
    '<meta name="description" content="' + escapeHtml(desc) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="PPP — Piano Practice Partner">',
    '<meta property="og:title" content="' + escapeHtml(title) + '">',
    '<meta property="og:description" content="' + escapeHtml(desc) + '">',
    '<meta property="og:url" content="' + escapeHtml(link) + '">',
    '<meta name="twitter:card" content="summary">',
    '<meta name="twitter:title" content="' + escapeHtml(title) + '">',
    '<meta name="twitter:description" content="' + escapeHtml(desc) + '">'
  ].filter(Boolean).join('\n');
}

/* The local helper (OMR, transcription, coach) binds 127.0.0.1:8788. A tablet
   on the LAN cannot reach that, so this process forwards /helper/* to it.
   Public production hosts have no Audiveris; they answer "not here" unless
   PPP_HELPER=1. */
const HELPER_URL = (process.env.PPP_HELPER_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
function helperEnabled() {
  if (process.env.PPP_HELPER === '0') return false;
  if (process.env.PPP_HELPER === '1') return true;
  return process.env.NODE_ENV !== 'production';
}
function proxyHelper(req, res, helperPath) {
  const pathOnly = String(helperPath || '/').split('?')[0] || '/';
  if (!helperEnabled()) {
    if (req.method === 'GET' && pathOnly === '/health') {
      return send(res, 200, { ok: false, remote: true, unreachable: true, service: 'ppp' });
    }
    return send(res, 503, {
      ok: false, remote: true, code: 'service-down',
      error: 'The local helper is not available on this host.'
    });
  }
  let dest;
  try { dest = new URL(helperPath || '/', HELPER_URL + '/'); }
  catch (e) { return jsonError(res, 400, 'Bad request'); }
  let allowed;
  try { allowed = new URL(HELPER_URL).origin; }
  catch (e) { return jsonError(res, 500, 'Helper URL is invalid'); }
  if (dest.origin !== allowed) return jsonError(res, 400, 'Bad request');

  const headers = {};
  Object.keys(req.headers).forEach(k => {
    const lk = k.toLowerCase();
    if (lk === 'host' || lk === 'origin' || lk === 'referer' || lk === 'connection' || lk === 'keep-alive') return;
    headers[k] = req.headers[k];
  });
  const hreq = http.request({
    protocol: dest.protocol,
    hostname: dest.hostname,
    port: dest.port,
    path: dest.pathname + dest.search,
    method: req.method,
    headers: headers,
    timeout: 10 * 60 * 1000
  }, hres => {
    const out = {};
    Object.keys(hres.headers || {}).forEach(k => {
      const lk = k.toLowerCase();
      if (lk === 'connection' || lk === 'keep-alive' || lk === 'transfer-encoding') return;
      out[k] = hres.headers[k];
    });
    res.writeHead(hres.statusCode || 502, out);
    hres.pipe(res);
  });
  hreq.on('timeout', () => hreq.destroy());
  hreq.on('error', () => {
    if (!res.headersSent) send(res, 200, { ok: false, unreachable: true, service: 'ppp-local' });
  });
  req.pipe(hreq);
}

/* G13-5 (docs/GOALS/G13 D16): headers every answer carries (set before anything is written, so the page, the API, the helper's proxy and the errors all have them).
   Referrer-Policy and X-Frame-Options: the page keeps its address from other sites' logs and is not framed by another site. HSTS: only for a request that came
   in over https (X-Forwarded-Proto, which Render sets; a browser ignores it over http), 180 days, no includeSubDomains and no preload, so it can be taken back;
   PPP_HSTS=0 turns it off if the edge already sends one. No Content-Security-Policy yet: the page runs inline scripts and styles and loads from three CDNs (G13-1, G13-8). */
function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https' && process.env.PPP_HSTS !== '0') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

const server = http.createServer((req, res) => {
  securityHeaders(req, res);
  const host = req.headers.host || ('localhost:' + PORT);
  let url;
  try { url = new URL(req.url, 'http://' + host); }
  catch (e) { return jsonError(res, 400, 'Bad request'); }

  if (url.pathname === '/helper' || url.pathname.indexOf('/helper/') === 0) {
    const rest = (url.pathname.slice('/helper'.length) || '/') + url.search;
    proxyHelper(req, res, rest);
    return;
  }

  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/health') {
    handleApi(req, res, url).catch(err => {
      console.error(err);
      if (!res.headersSent) jsonError(res, 500, 'Server error');
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonError(res, 405, 'Method not allowed');
  }
  serveStatic(req, res, url.pathname, url).catch(err => {
    console.error(err);
    if (!res.headersSent) jsonError(res, 500, 'Server error');
  });
});
/* G13-7a: counts every request and its answer; prependListener runs it before the handler above, so a request that handler refuses at once is counted too */
server.prependListener('request', serverStats.track);

/* The local helper (omr-service.js) is what makes PDF/photo recognition and
   high-quality piano transcription work. Forgetting to start it beside the
   app is the commonest way recognition silently degrades, so a local dev
   server starts it too — unless it is already running, or a production
   server (Render) has no helper to start. */
const OMR_PORT = Number(process.env.PPP_OMR_PORT) || 8788;
function startHelperIfMissing() {
  if (process.env.NODE_ENV === 'production') return;
  const probe = http.get({ host: '127.0.0.1', port: OMR_PORT, path: '/health', timeout: 2000 }, () => probe.destroy());
  probe.on('error', () => {});
  probe.on('timeout', () => probe.destroy());
  probe.on('close', () => {
    /* still nothing answered: try to start it once the probe is done */
    const check = http.get({ host: '127.0.0.1', port: OMR_PORT, path: '/health', timeout: 1500 }, r => {
      console.log('Local helper already running on http://127.0.0.1:' + OMR_PORT);
      check.destroy(); r.resume();
    });
    check.on('error', () => {
      const helper = spawn(process.execPath, [path.join(ROOT, 'omr-service.js')], {
        stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: false
      });
      helper.on('error', e => console.error('Could not start the local helper: ' + e.message));
      helper.on('exit', (code, signal) => {
        if (code !== 0 && !signal) console.error('Local helper exited (' + code + '). PDF/recognition runs as a browser draft; start "npm run omr" for high quality.');
      });
      console.log('Started the local helper on http://127.0.0.1:' + OMR_PORT);
    });
    check.on('timeout', () => check.destroy());
  });
}

/* Expired guest links are invisible at once (a GET is 404), but their rows are kept until swept: at start, and every few hours. */
function sweepGuestShares() {
  /* G13-5: and the address tags of accounts older than two days (store.purgeSignupTags) */
  return Promise.resolve(store.deleteExpiredShares(Date.now()))
    .then(() => store.purgeSignupTags(Date.now()))
    .catch(e => console.error('Guest link sweep failed:', e.message));
}

/* G12-5 (second review): a socket that never finishes its headers, or never ends a request, held memory for Node's defaults (60 s for the headers, 300 s for the request); 3000 of them were
   about 32 MB. The headers must arrive in 20 s, the whole request in 120 s (the body's own deadline is 60 s), and no more than PPP_MAX_CONNECTIONS (1000) sockets are open at once: past
   that a new one is dropped by Node, so a flood of sockets is an outage for its length, never an out-of-memory. An honest browser or Render's proxy holds a few dozen. */
server.headersTimeout = 20 * 1000;
/* ... NOT shorter than what the helper's proxy allows (proxyHelper: 10 minutes; /helper/transcribe takes 400 MB, /helper/omr and /helper/pdf-vector 80 MB, piped, never read by readBody):
   120 s cut a slow upload of a recording at 137 s (the third review). The JSON routes are protected by readBody's own 60 s / 10 s. */
server.requestTimeout = 10 * 60 * 1000;
server.maxConnections = Math.max(50, parseInt(process.env.PPP_MAX_CONNECTIONS, 10) || 1000);
/* A socket that has not sent ONE byte in 30 s is closed: with maxConnections and no such deadline 1,010 silent connects held all the places for as long as the headers timeout allowed.
   Once a byte has come the deadline is off (the headers have their own, and a request that dribbles with gaps is not touched). PPP_FIRST_BYTE_MS only lets a test see it pass in seconds. */
const FIRST_BYTE_MS = parseInt(process.env.PPP_FIRST_BYTE_MS, 10) || 30 * 1000;
server.on('connection', s => {
  s.setTimeout(FIRST_BYTE_MS, () => s.destroy());
  s.once('data', () => s.setTimeout(0));
});

store.ready().then(() => {
  seedSharedScores().catch(e => console.error('Seed library skipped:', e.message));
  return sweepGuestShares();
}).then(() => {
  setInterval(sweepGuestShares, GUEST.SWEEP_MS).unref();
  server.listen(PORT, HOST, () => {
    console.log('PPP listening on http://' + HOST + ':' + PORT);
    if (!jobsService.isDisabled()) console.log('Home-PC worker queue: an idle worker is told to wait ' + jobsService.config.idlePollS + ' s, a busy one ' + jobsService.config.activePollS + ' s (PPP_WORKER_IDLE_POLL_S, PPP_WORKER_ACTIVE_POLL_S)');
    if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: sessions and the keyed address tags use the public development secret.' + (GUEST_POSTS_NO_SECRET ? ' Guest posts to Shared Scores are OFF until it is set (links and accounts are not affected).' : ''));
    if (process.env.PPP_GUEST_POSTS === '0') console.log('Guest posts to Shared Scores are OFF (PPP_GUEST_POSTS=0): links and accounts are not affected.');
    if (syncService && !syncService.isDisabled()) console.log('Song sync: on (PPP_SYNC=1): a library is kept ' + Math.round(syncService.config.keepMs / 86400000) + ' days from its last sync, '
      + Math.round(syncService.config.totalBytes / 1048576) + ' MB in all');
    console.log('Guest links: the client address is read from ' + (process.env.RENDER ? 'CF-Connecting-IP, then True-Client-IP, then ' : '')
      + 'X-Forwarded-For (' + (Math.max(1, parseInt(process.env.PPP_PROXY_HOPS, 10) || 1)) + ' from the right), then the socket');
    if (HOST === '127.0.0.1' || HOST === 'localhost') startHelperIfMissing();
  });
}).catch(err => {
  console.error('Store failed to start', err);
  process.exit(1);
});
