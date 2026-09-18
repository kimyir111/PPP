#!/usr/bin/env node
/* PPP web server — static app + email/password auth + progress sync.
   Locally uses data/store.json. On Render, DATABASE_URL selects Postgres. */
'use strict';

const http = require('http');
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

/* ---------------- store ---------------- */
function fileStore() {
  const file = path.join(ROOT, 'data', 'store.json');
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
    }
  };
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
    }
  };
}

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

function serveStatic(req, res, urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') {
    const app = path.join(ROOT, 'Piano Coach App.dc.html');
    const html = fs.readFileSync(app);
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
    if (!user || !verifyPassword(password, user.passwordHash)) {
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

  jsonError(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || ('localhost:' + PORT);
  let url;
  try { url = new URL(req.url, 'http://' + host); }
  catch (e) { return jsonError(res, 400, 'Bad request'); }

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
  serveStatic(req, res, url.pathname);
});

store.ready().then(() => {
  server.listen(PORT, HOST, () => {
    console.log('PPP listening on http://' + HOST + ':' + PORT);
  });
}).catch(err => {
  console.error('Store failed to start', err);
  process.exit(1);
});
