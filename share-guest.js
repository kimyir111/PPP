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
  /* creates (and re-sends) per client address per hour, and for the whole server per hour */
  PER_IP_PER_HOUR: 10,
  GLOBAL_PER_HOUR: 200,
  HOUR_MS: 60 * 60 * 1000,
  /* what all guest links together may hold: the database is small and free */
  TOTAL_SHARES: 1000,
  TOTAL_BYTES: 100 * 1024 * 1024,
  /* a guest link is a loan, not a home */
  TTL_MS: 90 * 24 * 60 * 60 * 1000
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

/* A sliding window: at most `limit` hits per key in the last `windowMs`. A refused hit
   is not recorded, so waiting out the window always frees the key. */
function slidingWindow(limit, windowMs, clock) {
  const now = clock || Date.now;
  const hits = new Map();
  let sweptAt = 0;
  function prune(t) {
    /* now and then, drop keys with nothing left in the window, so the map cannot grow for ever */
    if (t - sweptAt < windowMs / 4 && hits.size < 5000) return;
    sweptAt = t;
    hits.forEach((list, key) => {
      if (!list.length || t - list[list.length - 1] >= windowMs) hits.delete(key);
    });
  }
  return {
    /* true when this hit is allowed (and recorded) */
    take(key) {
      const t = now();
      prune(t);
      const list = (hits.get(key) || []).filter(x => t - x < windowMs);
      if (list.length >= limit) { hits.set(key, list); return false; }
      list.push(t);
      hits.set(key, list);
      return true;
    },
    size() { return hits.size; }
  };
}

/* How a request names its client, as the login limit already did. */
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
}

module.exports = { GUEST, validSecret, guestOwnerId, isGuestOwner, sameOwner, expiryFor, expired, slidingWindow, clientIp };
