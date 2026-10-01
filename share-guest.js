/* Guest link sharing: the pure parts, so they can be tested with a clock they are given.

   A visitor with no account can send one of their songs as an UNLISTED link. The
   browser makes a random secret and keeps it in localStorage; every guest request
   carries it in the X-PPP-Guest header. The server never stores the secret, only
   owner_id = 'g_' + the first 24 hex of its sha256, so a database dump cannot be used to take a
   guest's links down, and the secret is never sent back. The header is what lets
   the same browser re-share a song (same row, same link) and stop sharing it later.

   A guest link is never listed in Shared Scores, and it expires. server.js does
   the HTTP and the store; the limits live here. */
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
  /* one guest link: the request (score, preview and the rest) may be this big; the preview alone this big */
  MAX_BYTES: 1024 * 1024,
  PREVIEW_MAX_BYTES: 24 * 1024,
  /* what the server keeps for all guest links together: the database is small and free (scores and previews, counted) */
  TOTAL_SHARES: 1000,
  TOTAL_BYTES: 50 * 1024 * 1024,
  /* a guest link is a loan, not a home; sending it again renews it */
  TTL_MS: 30 * 24 * 60 * 60 * 1000,
  /* sweep expired guest rows at start and this often */
  SWEEP_MS: 6 * 60 * 60 * 1000
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

function expiryFor(nowMs) {
  return new Date(nowMs + GUEST.TTL_MS).toISOString();
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

/* How a request names its client. Nothing the client writes may name it:
   1. on Render (RENDER is set), the headers its edge sets: True-Client-IP, then CF-Connecting-IP;
   2. else the X-Forwarded-For entry `hops` places from the RIGHT (PPP_PROXY_HOPS, default 1: the address the one
      proxy in front of this server appended), never the first, which the client writes;
   3. else the socket address.
   The login limit uses this too. `env` is for tests. */
function clientIp(req, env) {
  env = env || process.env;
  const h = req.headers || {};
  const one = v => String(Array.isArray(v) ? v[0] : v == null ? '' : v).trim();
  if (env.RENDER) {
    const direct = one(h['true-client-ip']) || one(h['cf-connecting-ip']);
    if (direct) return direct.slice(0, 64);
  }
  const hops = Math.max(1, parseInt(env.PPP_PROXY_HOPS, 10) || 1);
  const xff = one(h['x-forwarded-for']);
  if (xff) {
    const list = xff.split(',').map(x => x.trim());
    const at = list[list.length - hops];
    if (at) return at.slice(0, 64);
  }
  return String((req.socket && req.socket.remoteAddress) || '').slice(0, 64);
}

/* The one place that decides whether a guest link may be stored. `prev` is this browser's row for this song (or null),
   `ownerCount` how many links this browser has, `usage` what all guest links hold ({ count, bytes }), `newBytes` what
   this one would hold. Returns null when it may be, else { status, error, code }.
   A re-send replaces the old copy, so it counts as its growth: a tiny link re-sent at full size is held to the cap too. */
function decide(prev, ownerCount, usage, newBytes) {
  if (!prev && ownerCount >= GUEST.PER_GUEST) {
    return { status: 429, error: 'This browser has made as many guest links as PPP keeps. Stop sharing one, or sign in.' };
  }
  const count = usage.count + (prev ? 0 : 1);
  const bytes = usage.bytes - (prev ? (prev.bytes || 0) : 0) + newBytes;
  if (count > GUEST.TOTAL_SHARES || bytes > GUEST.TOTAL_BYTES) {
    return { status: 503, error: 'Guest links are full right now. Try again later, or sign in to share.', code: 'guest-full' };
  }
  return null;
}

/* What a row holds, as the guest accounting counts it: its score and its preview. */
function rowBytes(score, preview) {
  return Buffer.byteLength(JSON.stringify(score)) + (preview == null ? 0 : Buffer.byteLength(JSON.stringify(preview)));
}

module.exports = { GUEST, validSecret, guestOwnerId, isGuestOwner, sameOwner, expiryFor, expired, slidingWindow, clientIp, decide, rowBytes };
