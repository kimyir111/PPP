#!/usr/bin/env node
/* PPP web server — static app + email/password auth + progress sync + shared scores.
   Locally uses data/store.json. On Render, DATABASE_URL selects Postgres. */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  '.md': 'text/markdown; charset=utf-8'
};

const BLOCKED = new Set(['node_modules', 'tools', '.git', 'data', 'tests']);

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

function jsonError(res, status, message) {
  send(res, status, { error: message });
}

function readBody(req, limit) {
  const max = limit || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > max) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

function newShareId() {
  return crypto.randomBytes(9).toString('base64url');
}

function clipText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Just enough of a score to be one: measures and notes as arrays. */
function validScore(s) {
  return !!(s && typeof s === 'object' && Array.isArray(s.measures) && s.measures.length
    && s.measures.length <= 5000 && Array.isArray(s.notes));
}

/* What the list shows: no score, only the preview drawn on its card. */
function shareCard(row, viewer) {
  return {
    id: row.id, title: row.title, composer: row.composer, kind: row.kind,
    measures: row.measures, owner: row.ownerName, mine: !!(viewer && viewer.id === row.ownerId),
    songKey: viewer && viewer.id === row.ownerId ? row.songKey : undefined,
    listed: !!row.listed, preview: row.preview || null,
    createdAt: row.createdAt, updatedAt: row.updatedAt
  };
}

/* ---------------- store ---------------- */
function fileStore() {
  const file = path.join(ROOT, 'data', 'store.json');
  const sharesFile = path.join(ROOT, 'data', 'shares.json');
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
      const rows = loadShares().filter(r => opts.ownerId ? r.ownerId === opts.ownerId : r.listed);
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const q = (opts.q || '').toLowerCase();
      return rows.filter(r => !q || (r.title + ' ' + r.composer + ' ' + r.ownerName).toLowerCase().indexOf(q) > -1)
        .slice(0, opts.limit);
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
    }
  };
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
  async function q(sql, params) {
    if (!pool) {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: url,
        ssl: /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
        max: 5
      });
    }
    return pool.query(sql, params);
  }
  return {
    async ready() {
      await q(`
        CREATE TABLE IF NOT EXISTS ppp_users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ppp_progress (
          user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ppp_shares (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE,
          owner_name TEXT NOT NULL,
          song_key TEXT NOT NULL,
          title TEXT NOT NULL,
          composer TEXT NOT NULL DEFAULT '',
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
      `);
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
          'INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
          [user.id, user.email, user.displayName, user.passwordHash]
        );
        return user;
      } catch (e) {
        if (e && e.code === '23505') { const err = new Error('exists'); err.code = 'exists'; throw err; }
        throw e;
      }
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
      if (opts.ownerId) { params.push(opts.ownerId); where.push('owner_id = $' + params.length); }
      else where.push('listed');
      if (opts.q) {
        params.push('%' + opts.q.replace(/[\\%_]/g, '\\$&') + '%');
        where.push("(title || ' ' || composer || ' ' || owner_name) ILIKE $" + params.length);
      }
      params.push(opts.limit);
      const r = await q('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE ' + where.join(' AND ')
        + ' ORDER BY updated_at DESC LIMIT $' + params.length, params);
      return r.rows;
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
      await q(
        `INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, composer, kind, measures, listed, preview, score, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET owner_name = EXCLUDED.owner_name, title = EXCLUDED.title,
           composer = EXCLUDED.composer, kind = EXCLUDED.kind, measures = EXCLUDED.measures,
           listed = EXCLUDED.listed, preview = EXCLUDED.preview, score = EXCLUDED.score,
           updated_at = EXCLUDED.updated_at`,
        [row.id, row.ownerId, row.ownerName, row.songKey, row.title, row.composer, row.kind, row.measures,
          row.listed, row.preview == null ? null : JSON.stringify(row.preview), JSON.stringify(row.score),
          row.createdAt, row.updatedAt]
      );
      return row;
    },
    async deleteShare(id) {
      await q('DELETE FROM ppp_shares WHERE id = $1', [id]);
    }
  };
}

const SHARE_COLS = 'id, owner_id AS "ownerId", owner_name AS "ownerName", song_key AS "songKey", title, composer, kind, '
  + 'measures, listed, preview, created_at AS "createdAt", updated_at AS "updatedAt"';

const store = process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL) : fileStore();

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

async function serveStatic(req, res, urlPath, url) {
  if (urlPath === '/' || urlPath === '/index.html') {
    const app = path.join(ROOT, 'Piano Coach App.dc.html');
    let html = fs.readFileSync(app);
    const meta = await shareMeta(url && url.searchParams.get('share'), req);
    if (meta) {
      const text = html.toString('utf8');
      /* after the charset, which has to come first */
      html = Buffer.from(/<meta charset="utf-8">/i.test(text)
        ? text.replace(/<meta charset="utf-8">/i, m => m + '\n' + meta)
        : text.replace(/<head>/i, m => m + '\n' + meta));
    }
    send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return;
  }
  const abs = safePath(urlPath);
  if (!abs) return jsonError(res, 404, 'Not found');
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return jsonError(res, 404, 'Not found');
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    /* the piano recordings never change once shipped, and are the heaviest thing here */
    const cache = ext === '.html' || ext === '.js' || ext === '.json' ? 'no-store'
      : ext === '.mp3' ? 'public, max-age=2592000' : 'public, max-age=3600';
    fs.readFile(abs, (e2, buf) => {
      if (e2) return jsonError(res, 500, 'Read failed');
      send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': cache });
    });
  });
}

const loginAttempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip) || { n: 0, t: now };
  if (now - row.t > 15 * 60 * 1000) { row.n = 0; row.t = now; }
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

  if (method === 'GET' && p === '/api/youtube-title') {
    const raw = String(url.searchParams.get('url') || '').trim();
    let watch = null;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
      if (host === 'youtu.be') {
        const m = /^\/([\w-]{6,})$/.exec(u.pathname);
        if (m) watch = 'https://www.youtube.com/watch?v=' + m[1];
      } else if (host === 'youtube.com' && u.pathname === '/watch') {
        const v = u.searchParams.get('v') || '';
        if (/^[\w-]{6,}$/.test(v)) watch = 'https://www.youtube.com/watch?v=' + v;
      } else if (host === 'youtube.com') {
        const m = /^\/(shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
        if (m) watch = 'https://www.youtube.com/watch?v=' + m[2];
      }
    } catch (e) { watch = null; }
    if (!watch) return jsonError(res, 422, 'Not a YouTube video.');
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

  if (method === 'POST' && p === '/api/auth/signup') {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email) return jsonError(res, 422, 'Enter a valid email.');
    if (password.length < 8) return jsonError(res, 422, 'Password must be at least 8 characters.');
    const user = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      email: email,
      displayName: clipName(body.displayName || body.name, email),
      passwordHash: hashPassword(password)
    };
    try {
      await store.createUser(user);
    } catch (e) {
      if (e && e.code === 'exists') return jsonError(res, 409, 'An account with this email already exists.');
      console.error(e);
      return jsonError(res, 500, 'Could not create account.');
    }
    setCookie(res, signSession(user.id));
    send(res, 201, publicUser(user));
    return;
  }

  if (method === 'POST' && p === '/api/auth/login') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (tooMany(ip)) return jsonError(res, 429, 'Too many attempts. Try again later.');
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
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

  jsonError(res, 404, 'Not found');
}

async function handleShares(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const user = await currentUser(req);

  if (p === '/api/shares' && method === 'GET') {
    const mine = url.searchParams.get('mine') === '1';
    if (mine && !user) return jsonError(res, 401, 'Sign in to see your shared scores.');
    const rows = await store.listShares({
      ownerId: mine ? user.id : null,
      q: clipText(url.searchParams.get('q'), 80),
      limit: 100
    });
    send(res, 200, { shares: rows.map(r => shareCard(r, user)) }, { 'Cache-Control': 'no-store' });
    return;
  }

  if (p === '/api/shares' && method === 'POST') {
    if (!user) return jsonError(res, 401, 'Sign in to share your scores.');
    let raw, body;
    try { raw = await readBody(req, SHARE_MAX_BYTES); }
    catch (e) { return jsonError(res, 413, 'That score is too large to share.'); }
    try { body = JSON.parse(raw.toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    if (!body || !validScore(body.score)) return jsonError(res, 422, 'That is not a score PPP can share.');
    const songKey = clipText(body.songKey, 80);
    if (!songKey) return jsonError(res, 422, 'That is not a score PPP can share.');
    const title = clipText(body.title || body.score.title, 120);
    if (!title) return jsonError(res, 422, 'A shared score needs a title.');
    const prev = await store.findShare(user.id, songKey);
    if (!prev && await store.countShares(user.id) >= SHARES_PER_USER) {
      return jsonError(res, 429, 'You have shared as many scores as PPP keeps for one account.');
    }
    const preview = validScore(body.preview) && body.preview.measures.length <= 4
      && JSON.stringify(body.preview).length < 96 * 1024 ? body.preview : null;
    const now = new Date().toISOString();
    const row = {
      id: prev ? prev.id : newShareId(),
      ownerId: user.id, ownerName: user.displayName, songKey: songKey,
      title: title, composer: clipText(body.composer, 160), kind: clipText(body.kind, 24),
      measures: body.score.measures.length,
      /* sending a link never takes a posted score down, and never posts one */
      listed: typeof body.listed === 'boolean' ? body.listed : !!(prev && prev.listed),
      preview: preview, score: body.score,
      createdAt: prev ? prev.createdAt : now, updatedAt: now
    };
    await store.putShare(row);
    send(res, prev ? 200 : 201, Object.assign(shareCard(row, user), { url: '/?share=' + row.id }));
    return;
  }

  const m = /^\/api\/shares\/([\w-]{6,32})$/.exec(p);
  if (!m) return jsonError(res, 404, 'Not found');
  const row = await store.getShare(m[1]);
  if (!row) return jsonError(res, 404, 'That shared score is no longer there.');

  if (method === 'GET') {
    send(res, 200, Object.assign(shareCard(row, user), { score: row.score, url: '/?share=' + row.id }),
      { 'Cache-Control': 'no-store' });
    return;
  }
  if (!user || user.id !== row.ownerId) return jsonError(res, 403, 'Only the person who shared it can change that.');
  if (method === 'PATCH') {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch (e) { return jsonError(res, 400, 'Invalid JSON'); }
    if (typeof body.listed !== 'boolean') return jsonError(res, 422, 'Nothing to change.');
    row.listed = body.listed;
    row.updatedAt = new Date().toISOString();
    await store.putShare(row);
    send(res, 200, Object.assign(shareCard(row, user), { url: '/?share=' + row.id }));
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
  if (!row) return '';
  const proto = String(req.headers['x-forwarded-proto'] || (COOKIE_SECURE ? 'https' : 'http')).split(',')[0].trim();
  const link = proto + '://' + (req.headers.host || 'localhost') + '/?share=' + encodeURIComponent(row.id);
  const title = row.title + (row.composer ? ' · ' + row.composer : '');
  const desc = row.measures + (row.measures === 1 ? ' bar' : ' bars') + ' · shared by ' + row.ownerName + ' on PPP — Piano Practice Partner';
  return [
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
  ].join('\n');
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

const server = http.createServer((req, res) => {
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

store.ready().then(() => {
  server.listen(PORT, HOST, () => {
    console.log('PPP listening on http://' + HOST + ':' + PORT);
  });
}).catch(err => {
  console.error('Store failed to start', err);
  process.exit(1);
});
