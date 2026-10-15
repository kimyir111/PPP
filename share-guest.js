/* Guest sharing: the pure parts, so they can be tested with a clock they are given.

   A visitor with no account can send one of their songs as an UNLISTED link, and (G13 "no login
   anywhere") can POST it to the public Shared Scores. The browser makes a random secret and keeps it
   in localStorage; every guest request carries it in the X-PPP-Guest header (never in a URL). The
   server never stores the secret, only owner_id = 'g_' + the first 24 hex of its sha256, so a
   database dump cannot be used to take a guest's links down, and the secret is never sent back. The
   header is what lets the same browser re-share a song (same row, same link), see its own posts,
   take one down from the list, and stop sharing it later.

   Every guest row expires (30 days for a link, 90 for a post that is listed; sending it again renews
   it) and is counted against caps: per browser, per address, for the whole site. A post is refused
   with a clear answer (429 for "you", 503 `busy` for "the site"), never made room for by deleting
   somebody else's. server.js does the HTTP and the store; the limits live here. */
'use strict';
const crypto = require('crypto');

const GUEST = {
  HEADER: 'x-ppp-guest',
  PREFIX: 'g_',
  OWNER_NAME: 'Guest',
  /* one browser's own links */
  PER_GUEST: 20,
  /* creates per client address per hour (a class or a school may share one address), and for the whole server per hour.
     Only requests that would really make a link count: see FAILS_PER_IP_PER_HOUR for the rest. */
  PER_IP_PER_HOUR: 30,
  GLOBAL_PER_HOUR: 200,
  /* requests that fail validation (not a score, too big, bad JSON) get a small budget of their own per address, so they
     can neither be free nor burn the creates budget */
  FAILS_PER_IP_PER_HOUR: 60,
  HOUR_MS: 60 * 60 * 1000,
  /* the most a limiter table remembers; the oldest key is forgotten first */
  MAX_KEYS: 10000,
  /* a posted score may nest this deep (a real one is a handful of levels); deeper is refused, and cannot be read back */
  MAX_DEPTH: 64,
  /* one guest link: the request (score, preview and the rest) may be this big; the preview alone this big */
  MAX_BYTES: 1024 * 1024,
  PREVIEW_MAX_BYTES: 24 * 1024,
  /* what the server keeps for all guest links together: the database is small and free (scores and previews, counted) */
  TOTAL_SHARES: 1000,
  TOTAL_BYTES: 50 * 1024 * 1024,
  /* a guest link is a loan, not a home; sending it again renews it */
  TTL_MS: 30 * 24 * 60 * 60 * 1000,
  /* sweep expired guest rows at start and this often */
  SWEEP_MS: 6 * 60 * 60 * 1000,

  /* ---- G13 no login: posting to the PUBLIC list as a guest ----
     A post is a guest row with listed = true. It is held to everything above (the same 1 MB, the same 20 rows a browser, the same totals) and to its own caps.
     A post lives longer than a link (people look for a score in the list for longer than they keep a link), and still ends: a list that nobody tends cleans itself. */
  TTL_LISTED_MS: 90 * 24 * 60 * 60 * 1000,
  /* how many posts one browser, one address (a class may share one) and the whole site hold AT ONCE, and the most bytes the posts hold in all */
  PER_GUEST_LISTED: 10,
  PER_ADDR_LISTED: 20,
  TOTAL_LISTED: 300,
  TOTAL_LISTED_BYTES: 24 * 1024 * 1024,
  /* how many times a day a request may PUT a score into the public list (a new post, a changed one, a taken-down one put back), by browser key, by address, and for the site.
     Counted in memory like the hourly limits above; the totals above are what survive a restart. */
  DAY_MS: 24 * 60 * 60 * 1000,
  POST_PER_KEY_PER_DAY: 5,
  POST_PER_IP_PER_DAY: 10,
  POST_GLOBAL_PER_DAY: 150,
  /* the name a guest may give a post, in characters (code points) */
  NAME_MAX: 24
};

/* The secret is a random string from the browser: letters, digits, - and _, 32 to 128 long. */
function validSecret(secret) {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(secret);
}

/* 'g_' + 24 hex of sha256(secret), or null when there is no usable secret. It is a
   one-way name: it never contains or equals the secret, and cannot collide with a
   user id (those are UUIDs). */
function guestOwnerId(secret) {
  if (!validSecret(secret)) return null;
  return GUEST.PREFIX + crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 24);
}

function isGuestOwner(ownerId) {
  return typeof ownerId === 'string' && ownerId.indexOf(GUEST.PREFIX) === 0 && /^g_[0-9a-f]{24}$/.test(ownerId);
}

/* A guest id is compared as bytes of equal length, never by short-circuit. */
function sameOwner(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* when a row written now ends: 30 days for a link, 90 for a post that is listed */
function expiryFor(nowMs, listed) {
  return new Date(nowMs + (listed ? GUEST.TTL_LISTED_MS : GUEST.TTL_MS)).toISOString();
}

/* Text that is shown to everybody (a title, a composer, a name, a label inside a preview): C0 and C1 controls, soft hyphens, zero-width and bidi-override / isolate
   characters, line and paragraph separators and the byte order mark are made spaces (a right-to-left override reorders the text AROUND it: "Shared by ..." reads backwards),
   white space is collapsed, and it is cut to \`max\` characters by code point (no surrogate pair is split). */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
function cleanText(raw, max) {
  const s = String(raw == null ? '' : raw).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max || 200).join('').trim();
}

/* What a name is compared with, to see whether it passes for the site or its owner: compatibility-normalised (fullwidth and styled letters are plain ones), accents and
   combining marks removed, lower case, the look-alike letters of Cyrillic and Greek made Latin, and everything that is not a letter or a digit dropped ("P P P", "p.p.p"). */
const LOOKALIKE = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd',
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ɑ': 'a', 'ı': 'i', 'ɡ': 'g' };
function nameKey(s) {
  let t = String(s == null ? '' : s).normalize('NFKC').normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase();
  t = t.replace(/[^\p{L}\p{N}]/gu, '').replace(/[\u0370-\u03ff\u0400-\u04ff\u0250-\u02af\u0131]/g, c => LOOKALIKE[c] || c);
  return t;
}
/* what a guest may not be called (the name is matched ANYWHERE in the folded name): the site, its owner, and what a moderator or a team is called */
const NOT_A_GUEST = ['ppp', 'pianopracticepartner', 'admin', 'administrator', 'moderator', 'support', 'official', 'staff', 'owner', 'system', 'operator', 'webmaster', 'helpdesk',
  '관리자', '운영자', '운영진', '공식', '고객센터', '管理', '官方', '客服', '运营', '運営', '公式', '管理者', 'サポート', 'オーナー'];

const NOT_A_GUEST_KEYS = NOT_A_GUEST.map(nameKey);

/* The name a guest's post carries in the list. Nothing typed is trusted: it is cleaned (cleanText), more than two combining marks in a row are cut (zalgo), it is cut to
   NAME_MAX characters, and it must not pass for the site, its owner or its staff (nameKey, matched anywhere, against NOT_A_GUEST) nor look like an address or a contact. Such
   names, and none, are "Guest", which the page shows in the person's language. The page also writes "(guest)" after every name of a guest, so no name can pass for the site. */
function guestName(raw) {
  if (typeof raw !== 'string') return GUEST.OWNER_NAME;
  let s = cleanText(raw, 200).replace(/(\p{M}{2})\p{M}+/gu, '$1');
  s = Array.from(s).slice(0, GUEST.NAME_MAX).join('').trim();
  if (!s) return GUEST.OWNER_NAME;
  const flat = s.normalize('NFKC');
  if (/https?:|www\.|@|\.(?:com|net|org|io|kr|jp|cn|co|me|app|dev|xyz)(?![a-z0-9])/i.test(flat)) return GUEST.OWNER_NAME;
  const key = nameKey(s);
  if (NOT_A_GUEST_KEYS.some(w => key.indexOf(w) > -1)) return GUEST.OWNER_NAME;
  return s;
}

/* A whole score is not rebuilt (it is the person's own data, up to 1 MB, with fields this file does not know), but the two things a drawing loops over are bounded, and
   the text it shows is cleaned: its title and composer, staves and every note's staff (1 to 8). In place; an honest score is not changed. */
function cleanScore(score) {
  if (!score || typeof score !== 'object') return;
  const staff = v => { const s = Number(v); return Number.isFinite(s) ? Math.min(8, Math.max(1, Math.round(s))) : 1; };
  if (typeof score.title === 'string') score.title = cleanText(score.title, 120);
  if (typeof score.composer === 'string') score.composer = cleanText(score.composer, 160);
  if (score.staves !== undefined) score.staves = staff(score.staves);
  if (Array.isArray(score.notes)) score.notes.forEach(n => { if (n && typeof n === 'object' && n.staff !== undefined) n.staff = staff(n.staff); });
}

/* A row that was listed within the last day (a post taken down and put back the same day is one post, not two places of the day): its end date still has more than
   TTL_LISTED_MS - DAY_MS to run, which only a listing writes (a link ends in 30 days, and a re-sent link resets it). */
function recentlyListed(row, nowMs) {
  if (!row || !row.expiresAt) return false;
  const t = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Date.parse(row.expiresAt);
  return Number.isFinite(t) && t - nowMs > GUEST.TTL_LISTED_MS - GUEST.DAY_MS;
}

/* The preview of a share (the opening bars drawn on its card) is a mini score the page's ENGRAVER draws. An engraver that loops over \`staves\` or \`staff\` is hung by
   1e6 there, for everybody who opens the list, so what is stored - and what is handed out - is rebuilt from what a preview is: at most 4 bars and 400 notes, every number
   finite and small, staves and staff 1 or 2, voices 1..8, dots 0..4, times and keys in their ranges, strings cleaned and short, objects bounded in depth and in keys, and
   nothing the shapes below do not name left to chance (a key that is not a plain name, __proto__, a function or a huge array is dropped). An honest preview comes back
   unchanged (tests/guest-post.test.js: the previews of real scores are returned equal); anything else is neutralised, never drawn as sent. null: not a preview at all.
   The page has the same rules for the scores it draws (Piano Coach App.dc.html, thumbSafe: tests/guest-post.test.js holds the two to the same answers). */
const PREVIEW = { MEASURES: 4, NOTES: 400, EVENTS: 64, STRING: 80, NUMBER: 1000, KEYS: 48, DEPTH: 6 };
function normalizePreview(raw, maxMeasures) {
  const L = PREVIEW;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const fin = v => typeof v === 'number' && isFinite(v);
  const num = (v, lo, hi, d) => { const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return fin(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const int = (v, lo, hi, d) => { const x = num(v, lo, hi, null); return x === null ? d : Math.round(x); };
  const BAD = { __proto__: null, constructor: 1, prototype: 1 };
  const any = (v, depth) => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return fin(v) ? Math.min(L.NUMBER, Math.max(-L.NUMBER, v)) : null;
    if (typeof v === 'string') return cleanText(v, L.STRING);
    if (depth >= L.DEPTH) return null;
    if (Array.isArray(v)) return v.slice(0, L.EVENTS).map(x => any(x, depth + 1));
    if (isObj(v)) {
      const o = {};
      let n = 0;
      for (const k of Object.keys(v)) {
        if (k === '__proto__' || BAD[k] === 1 || !/^[\w$]{1,32}$/.test(k)) continue;
        if (++n > L.KEYS) break;
        o[k] = any(v[k], depth + 1);
      }
      return o;
    }
    return null;
  };
  if (!isObj(raw) || !Array.isArray(raw.measures) || !Array.isArray(raw.notes)) return null;
  const maxM = Math.min(L.MEASURES, maxMeasures || L.MEASURES);
  const seen = {};
  const measures = [];
  raw.measures.slice(0, maxM).forEach((m, i) => {
    if (!isObj(m)) return;
    const o = any(m, 0);
    o.number = int(m.number, -99, 999, i + 1);
    if (seen[o.number]) return;
    seen[o.number] = true;
    const t = isObj(m.time) ? m.time : {};
    const bt = [1, 2, 4, 8, 16, 32, 64].indexOf(+t.beatType) > -1 ? +t.beatType : 4;
    const beats = int(t.beats, 1, 32, 4);
    o.time = { beats: beats, beatType: bt };
    const k = isObj(m.key) ? m.key : {};
    o.key = { fifths: int(k.fifths, -7, 7, 0), mode: k.mode === 'minor' ? 'minor' : 'major' };
    if (fin(m.lenQ) && m.lenQ > 0) o.lenQ = Math.min(32, m.lenQ); else delete o.lenQ;
    measures.push(o);
  });
  if (!measures.length) return null;
  const notes = [];
  let maxStaff = 1;
  for (const n of raw.notes) {
    if (notes.length >= L.NOTES) break;
    if (!isObj(n)) continue;
    const m = int(n.m, -99, 999, null);
    if (m === null || !seen[m]) continue;
    const o = any(n, 0);
    o.m = m;
    o.b = num(n.b, 0, 64, 0);
    o.dur = num(n.dur, 0, 64, 1);
    o.voice = int(n.voice, 1, 8, 1);
    o.staff = int(n.staff, 1, 4, 1);
    o.dots = int(n.dots, 0, 4, 0);
    if (o.staff > maxStaff) maxStaff = o.staff;
    ['midi', 'writtenMidi', 'soundingMidi'].forEach(k => { if (n[k] !== undefined && n[k] !== null) { const x = int(n[k], -48, 200, null); if (x === null) delete o[k]; else o[k] = x; } });
    if (n.ottavaShift !== undefined && n.ottavaShift !== null) o.ottavaShift = int(n.ottavaShift, -24, 24, 0);
    if (n.hand !== undefined && n.hand !== null) o.hand = n.hand === 'l' || n.hand === 'x' ? n.hand : 'r';
    ['rest', 'chord', 'tieStart', 'tieStop', 'slurStart', 'slurStop'].forEach(k => { if (n[k] !== undefined) o[k] = !!n[k]; });
    if (isObj(n.tm)) o.tm = { a: int(n.tm.a, 1, 32, 3), n: int(n.tm.n, 1, 32, 2) }; else delete o.tm;
    if (n.finger !== undefined) { const f = int(n.finger, 1, 5, null); if (f === null) delete o.finger; else o.finger = f; }
    notes.push(o);
  }
  const out = {};
  const SIDE = ['chords', 'pedals', 'marks', 'dynamics', 'wedges', 'tempos'];
  const HANDLED = { measures: 1, notes: 1, staves: 1, sections: 1, ottavas: 1, title: 1, composer: 1, tempo: 1, id: 1, _byNumber: 1 };
  SIDE.forEach(k => { HANDLED[k] = 1; });
  for (const k of Object.keys(raw)) {
    if (HANDLED[k] || k === '__proto__' || BAD[k] === 1 || !/^[\w$]{1,32}$/.test(k)) continue;
    if (Object.keys(out).length >= L.KEYS) break;
    out[k] = any(raw[k], 1);
  }
  out.id = cleanText(raw.id, 64);
  out.title = cleanText(raw.title, 120);
  out.composer = cleanText(raw.composer, 160);
  out.tempo = num(raw.tempo, 20, 400, 84);
  out.staves = Math.max(int(raw.staves, 1, 4, 1), maxStaff);
  out.measures = measures;
  out.notes = notes;
  SIDE.forEach(k => {
    const list = [];
    (Array.isArray(raw[k]) ? raw[k] : []).forEach(e => {
      if (list.length >= L.EVENTS || !isObj(e)) return;
      const m = int(e.m, -99, 999, null);
      if (m === null || !seen[m]) return;
      const o = any(e, 0);
      o.m = m;
      if (e.b !== undefined) o.b = num(e.b, 0, 64, 0);
      list.push(o);
    });
    out[k] = list;
  });
  out.ottavas = [];
  out.sections = [{ id: 's1', from: measures[0].number, to: measures[measures.length - 1].number }];
  return out;
}

/* A row with an expiry in the past is gone, whether or not it has been swept yet. */
function expired(row, nowMs) {
  if (!row || !row.expiresAt) return false;
  const t = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Date.parse(row.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/* A sliding window: at most `limit` hits per key in the last `windowMs`. A refused hit is not recorded, and a key is only
   ever added by a hit that is allowed, so refused or garbage requests cannot grow the table. The table is bounded
   (`maxKeys`, the least recently used key is dropped) and idle keys are swept now and then, amortised. */
function slidingWindow(limit, windowMs, clock, maxKeys) {
  const now = clock || Date.now;
  const cap = maxKeys || GUEST.MAX_KEYS;
  const hits = new Map();
  let sweptAt = now();
  function live(key, t) {
    const list = hits.get(key);
    if (!list) return null;
    while (list.length && t - list[0] >= windowMs) list.shift();
    return list;
  }
  function sweep(t) {
    if (t - sweptAt < windowMs / 4) return;
    sweptAt = t;
    hits.forEach((list, key) => {
      while (list.length && t - list[0] >= windowMs) list.shift();
      if (!list.length) hits.delete(key);
    });
  }
  return {
    /* would a hit be allowed? Records nothing. */
    peek(key) {
      const list = live(key, now());
      return !list || list.length < limit;
    },
    /* true when this hit is allowed (and recorded) */
    take(key) {
      const t = now();
      sweep(t);
      let list = live(key, t);
      if (list && list.length >= limit) return false;
      if (!list) {
        while (hits.size >= cap) hits.delete(hits.keys().next().value);
        list = [];
      } else hits.delete(key);
      list.push(t);
      hits.set(key, list);
      return true;
    },
    /* give back the newest hit of a key (the request turned out not to make a link) */
    release(key) {
      const list = hits.get(key);
      if (!list) return;
      list.pop();
      if (!list.length) hits.delete(key);
    },
    size() { return hits.size; }
  };
}

/* How a request names its client, and where the name came from. Nothing the client writes may name it:
   1. on Render (RENDER is set), the headers its edge sets: CF-Connecting-IP (the one Cloudflare is documented to set
      itself), then True-Client-IP;
   2. else the X-Forwarded-For entry `hops` places from the RIGHT (PPP_PROXY_HOPS, default 1: the address the one
      proxy in front of this server appended), never the first, which the client writes;
   3. else the socket address.
   `env` is for tests. */
function clientAddress(req, env) {
  env = env || process.env;
  const h = req.headers || {};
  const one = v => String(Array.isArray(v) ? v[0] : v == null ? '' : v).trim();
  if (env.RENDER) {
    const cf = one(h['cf-connecting-ip']);
    if (cf) return { ip: cf.slice(0, 64), source: 'cf-connecting-ip' };
    const tc = one(h['true-client-ip']);
    if (tc) return { ip: tc.slice(0, 64), source: 'true-client-ip' };
  }
  const hops = Math.max(1, parseInt(env.PPP_PROXY_HOPS, 10) || 1);
  const xff = one(h['x-forwarded-for']);
  if (xff) {
    const list = xff.split(',').map(x => x.trim());
    const at = list[list.length - hops];
    if (at) return { ip: at.slice(0, 64), source: 'x-forwarded-for (' + hops + ' from the right)' };
  }
  return { ip: String((req.socket && req.socket.remoteAddress) || '').slice(0, 64), source: 'socket' };
}
/* The login limit uses this too. */
function clientIp(req, env) { return clientAddress(req, env).ip; }

/* NUL and lone surrogates are legal in a JSON text but cannot be stored (Postgres refuses them): they are not a score. */
const BAD_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/* Walk a posted value (iteratively: it may be nested 200000 deep) and say what is wrong with it, or null:
   'text' (NUL or a lone surrogate in a string or a key) or 'depth' (nested more than maxDepth containers). */
function inspect(root, maxDepth) {
  const limit = maxDepth || GUEST.MAX_DEPTH;
  const stack = [root, 0];
  while (stack.length) {
    const depth = stack.pop();
    const v = stack.pop();
    if (typeof v === 'string') { if (BAD_TEXT.test(v)) return 'text'; continue; }
    if (!v || typeof v !== 'object') continue;
    if (depth >= limit) return 'depth';
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push(v[i], depth + 1);
    } else {
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        if (BAD_TEXT.test(keys[i])) return 'text';
        stack.push(v[keys[i]], depth + 1);
      }
    }
  }
  return null;
}

/* The one place that decides whether a guest link may be stored. `prev` is this browser's row for this song (or null),
   `ownerCount` how many links this browser has, `usage` what all guest links hold ({ count, bytes }), `newBytes` what
   this one would hold. Returns null when it may be, else { status, error, code }.
   A re-send replaces the old copy, so it counts as its growth: a tiny link re-sent at full size is held to the cap too.
   `listing` (G13 no login) is given when the row will be LISTED: { ownerListed, addrListed, totalListed, totalListedBytes } are the posts held now (this row's own
   previous copy included, when it was listed). A row that was not listed and becomes so is a new post and is held to the three counts; a post that is re-sent
   is held to the bytes of all posts. The refusals are the person's own (429) or the site's (503 `busy`: refused, never made room for by deleting someone's). */
function decide(prev, ownerCount, usage, newBytes, listing) {
  if (!prev && ownerCount >= GUEST.PER_GUEST) {
    return { status: 429, error: 'This browser has made as many links as PPP keeps. Stop sharing one first.' };
  }
  const count = usage.count + (prev ? 0 : 1);
  const bytes = usage.bytes - (prev ? (prev.bytes || 0) : 0) + newBytes;
  if (count > GUEST.TOTAL_SHARES || bytes > GUEST.TOTAL_BYTES) {
    return { status: 503, error: 'Sharing by link is full right now. Try again later.', code: 'guest-full' };
  }
  if (listing) {
    const wasListed = !!(prev && prev.listed);
    if (!wasListed) {
      if (listing.ownerListed >= GUEST.PER_GUEST_LISTED) return { status: 429, code: 'too-many-posts', error: 'This browser has posted as many scores as PPP keeps for a guest. Take one down first.' };
      if (listing.addrListed >= GUEST.PER_ADDR_LISTED) return { status: 429, code: 'too-many-posts', error: 'As many scores as PPP keeps are posted from here already. Take one down, or try again later.' };
      if (listing.totalListed >= GUEST.TOTAL_LISTED) return { status: 503, code: 'busy', error: BUSY };
    }
    if (listing.totalListedBytes - (wasListed ? (prev.bytes || 0) : 0) + newBytes > GUEST.TOTAL_LISTED_BYTES) return { status: 503, code: 'busy', error: BUSY };
  }
  return null;
}
const BUSY = 'Shared Scores has no room for more posts from guests right now. Try again later.';

/* What a row holds, as the guest accounting counts it: its score and its preview. */
function rowBytes(score, preview) {
  return Buffer.byteLength(JSON.stringify(score)) + (preview == null ? 0 : Buffer.byteLength(JSON.stringify(preview)));
}

module.exports = { GUEST, BUSY, PREVIEW, validSecret, guestOwnerId, isGuestOwner, sameOwner, expiryFor, cleanText, cleanScore, guestName, nameKey, recentlyListed, normalizePreview, expired, slidingWindow, clientIp, clientAddress, inspect, decide, rowBytes };
