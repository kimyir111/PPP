/* Reading the body of a request, bounded in size, in TIME, in SHAPE and in MEMORY (G12-5, after the two security reviews of PR 269). server.js (every JSON route) and home-jobs.js (the
   home-PC queue) read their bodies through this one function.

   What an unbounded `req.on('data', c => chunks.push(c))` costs, measured by the reviewer: ONE socket of 1.4 million 1-byte writes (1.4 MB, inside every size cap) held
   about 350 bytes of Buffer per byte and ended the server by its heap in ten seconds, whatever the route. So here:

     - SIZE   over `limit` the body is read and thrown away up to `drain` (so the answer reaches the sender on an open connection), beyond that the socket is cut;
     - MEMORY small chunks are coalesced as they arrive (`tail`: at most 512 of them or 64 KB, then one Buffer.concat), so the number of Buffers held is bounded by the number of BYTES
              / 64 KB, not by how the sender chose to cut them. The idle timer is armed once and looked at, never re-armed per chunk;
     - TIME   a deadline for the whole body (`totalMs`) and one for the gap between two chunks (`idleMs`): a socket that stalls or drips is cut, whatever it holds;
     - SHAPE  the JSON structure (tokens, containers, depth outside strings: home-omr.js jsonGuard) is counted as the bytes arrive, before anything is parsed: JSON.parse of
              `[{},{},...]` takes 22 bytes of heap for every 3 bytes of body.

   Resolves a Buffer, or rejects with an Error whose .code is TOO_LARGE | SHAPE | SLOW | ABORTED. Everything it set (timers, listeners) is removed when it settles. */
'use strict';
const H = require('./home-omr');

const DEFAULTS = Object.freeze({ totalMs: 60 * 1000, idleMs: 10 * 1000 });
/* chunks smaller than this are coalesced; a chunk this big is kept as it is */
const BIG_CHUNK = 16 * 1024;
const TAIL_CHUNKS = 512;
const TAIL_BYTES = 64 * 1024;

/* o = { limit, drain?, shape?, totalMs?, idleMs?, destroyOnSlow? }
   destroyOnSlow: the socket is cut when a deadline passes (for a caller that answers with its own JSON error and does not close the connection: the answer would sit behind a body that
   never arrives); without it the caller answers 408 and closes (home-jobs.js). */
function readBody(req, o) {
  return new Promise((resolve, reject) => {
    const limit = o.limit, drain = o.drain || limit;
    const totalMs = o.totalMs || DEFAULTS.totalMs, idleMs = o.idleMs || DEFAULTS.idleMs;
    const guard = o.shape ? H.jsonGuard(o.shape) : null;
    let chunks = [], tail = [], tailBytes = 0, n = 0, why = null, settled = false, total = null, idle = null, lastAt = Date.now();
    const err = (code, message) => Object.assign(new Error(message || code), { code: code });
    const flush = () => {
      if (!tail.length) return;
      chunks.push(tail.length === 1 ? tail[0] : Buffer.concat(tail, tailBytes));
      tail = []; tailBytes = 0;
    };
    const cleanup = () => {
      clearTimeout(total); clearTimeout(idle);
      req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('error', onError); req.removeListener('close', onClose);
    };
    const settle = (fn, v) => { if (settled) return; settled = true; cleanup(); chunks = []; tail = []; fn(v); };
    const slow = which => { if (o.destroyOnSlow) { try { req.destroy(); } catch (e) { /* gone */ } } settle(reject, err('SLOW', which)); };
    const onData = c => {
      if (settled) return;
      n += c.length; lastAt = Date.now();
      if (why) { if (n > drain) { req.destroy(); settle(reject, err(why)); } return; }
      if (n > limit) {
        if (n <= drain && drain > limit) { why = 'TOO_LARGE'; chunks = []; tail = []; tailBytes = 0; return; }
        req.destroy();
        return settle(reject, err('TOO_LARGE'));
      }
      if (guard && guard.push(c) === 'shape') { why = 'SHAPE'; chunks = []; tail = []; tailBytes = 0; return; }
      if (c.length >= BIG_CHUNK) { flush(); chunks.push(c); return; }
      tail.push(c); tailBytes += c.length;
      if (tail.length >= TAIL_CHUNKS || tailBytes >= TAIL_BYTES) flush();
    };
    const onEnd = () => {
      if (why) return settle(reject, err(why));
      flush();
      settle(resolve, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
    };
    const onError = e => settle(reject, err('ABORTED', e && e.message));
    const onClose = () => settle(reject, err('ABORTED'));
    /* the gap deadline is armed once and looked at when it fires (no timer is touched per chunk: a flood of 1-byte chunks would make that the cost) */
    const onIdle = () => {
      const left = idleMs - (Date.now() - lastAt);
      if (left > 5) idle = setTimeout(onIdle, left); else slow('idle');
    };
    total = setTimeout(() => slow('total'), totalMs);
    idle = setTimeout(onIdle, idleMs);
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('close', onClose);
  });
}

/* the structure a stock JSON body of `limit` bytes may have: no more containers than one per 16 bytes (a score or a progress record has an object every 30 bytes or so; `{},` is 3), and
   no deeper than the nesting guestShare.inspect refuses anyway (64). Tokens are not bounded separately (a comma costs nothing beyond its element). */
function stockShape(limit) {
  return { tokens: limit, containers: Math.max(256, Math.floor(limit / 16)), depth: 80 };
}
/* the bodies of a few fields: an email and a password, {listed}, a claim */
const SMALL_SHAPE = Object.freeze({ tokens: 64, containers: 8, depth: 6 });

module.exports = { readBody, stockShape, SMALL_SHAPE, DEFAULTS };
