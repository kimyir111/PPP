/* G13-S0 (docs/GOALS/G13_PRODUCTIZATION.md section 7, "as built" in 7.9): "use my songs on other devices" - the SERVER half, with no account.

   A person's songs and progress are kept on the site as a LIBRARY behind a secret code, the way a PC link is (docs/GOALS/G10B_HOME_WORKER.md section 12) and with the lessons of
   the two security reviews of G12-5 built in from the start (docs/GOALS/G12_OMR.md section 24):

     - CAPABILITY CODE. The server makes it (256 random bits, 64 hex) and shows it ONCE; only sha256('ppp-lib-v1:' + code) is kept. It travels in the header X-PPP-Lib of this
       site's own page (credentials omitted, CORS closed, an Origin that is not this site is 403 BEFORE the code is read); never in a URL or a body, never logged. No header is
       401 before anything else; a wrong code is counted per address (20 an hour, then 429), FAILURES only; the compare is constant time.
     - NO BODY IS READ UNTIL THE CODE IS KNOWN, and then it is read by body-reader.js, the one reader of the site: bounded in size, in time (60 s / 10 s), in memory (chunks are
       coalesced) and in SHAPE (home-omr.js jsonGuard, counted as the bytes arrive, before anything is parsed) - and the same guard runs again over the DECOMPRESSED bytes of every
       item, which is where a zip bomb or a million-object JSON hides. One place per library, one per address and eight for the site hold a body while it arrives; two items are
       unpacked at a time (a ceiling no sender can hold); six answers with bodies are made at a time.
     - ITEMS are stored gzip (BYTEA); the server inflates with a hard output cap, checks the shape of a song, and stores the compressed bytes it was given.
     - EVERY BUDGET IS HELD THREE WAYS (the site's, and a QUARTER of it for each library and for each creating address), so one stranger cannot use up what everybody else
       needs: bytes written, bytes read, items written, items read, libraries made, stored bytes. Synced content is NEVER evicted to make room: at a cap the answer is
       503 `quota` / `busy` (G13-D8).
     - An idle poll (`changes` with the revision the device already has) answers from memory: ZERO statements.

   One instance: the libraries, their counters and the limiters are in this process; the database is the durable copy (as the PC queue). The SQL guards (the library in every
   WHERE, the base revision re-checked in the write) keep every row right if a second instance ever ran; its counters then could drift (said in 7.9).

   Routes (all JSON; section 7.3 of the doc): POST /api/libs, GET /api/sync/changes, GET /api/sync/items, PUT /api/sync/items, DELETE /api/sync/items/:key,
   POST /api/libs/me/rotate, DELETE /api/libs/me. Not mounted at all (404 like any unknown path) unless the server runs with PPP_SYNC=1. */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const guestShare = require('./share-guest');
const H = require('./home-omr');
const bodyReader = require('./body-reader');
const homeJobs = require('./home-jobs');
const SS = require('./sync-store');

const MiB = 1048576;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const LIMITS = {
  /* ---- libraries: made by anybody, so bounded ---- */
  LIBS_PER_IP_PER_HOUR: 5,
  LIBS_PER_IP_PER_DAY: 20,
  LIBS_PER_HOUR: 100,
  /* live libraries; at it the answer is 503 `busy`: nobody is evicted (a library holds a person's songs) */
  MAX_LIBS: 2000,
  /* ---- keeping times ---- */
  KEEP_MS: 180 * DAY,                    /* from the last sync of any device (U2) */
  EMPTY_KEEP_MS: 14 * DAY,               /* a library with nothing in it, from its last use */
  TOMBSTONE_KEEP_MS: 30 * DAY,           /* "recently deleted" */
  REVOKED_KEEP_MS: 2 * DAY,              /* so that making and deleting libraries does not get round the per-address limits */
  /* the database is told that a library was used at most this often (an idle poll writes nothing of its own: it is part of a request that runs anyway, once a day) */
  TOUCH_MS: 1 * DAY,
  PURGE_EVERY_MS: 6 * HOUR,
  /* ---- what a library may hold ---- */
  KEYS_PER_BATCH: 25,
  ITEM_GZIP_MAX: 1 * MiB,
  ITEM_INFLATED_MAX: 8 * MiB,
  REQUEST_GZIP_MAX: 4 * MiB,
  REQUEST_INFLATED_MAX: 16 * MiB,
  /* rows (live and tombstones) of one library and of the site: a row costs its overhead whatever its body, so the byte caps below do not bound them alone */
  LIB_ROWS: 3000,
  SITE_ROWS: 60000,
  LIB_BYTES: 16 * MiB,
  ADDRESS_BYTES: 48 * MiB,
  TOTAL_BYTES: 128 * MiB,
  WARN_AT: 0.8,
  /* ---- rates ---- */
  /* items applied per library per hour (a batch of n takes n; what is refused or conflicts is given back) and deletions among them */
  WRITES_PER_HOUR: 240,
  DELETES_PER_HOUR: 60,
  /* requests that WRITE (PUT, DELETE) whatever came of them, per library and per address: a refused request is free of the item budgets but not of the work it cost */
  WRITE_REQUESTS_PER_HOUR: 120,
  WRITE_REQUESTS_PER_IP_PER_HOUR: 480,
  /* a `changes` that has to ask the database, per library and per address (an idle poll asks nothing and is not counted) */
  CHANGES_SQL_PER_HOUR: 120,
  CHANGES_SQL_PER_IP_PER_HOUR: 600,
  READ_ITEMS_PER_HOUR: 300,
  ROTATES_PER_HOUR: 5,
  ROTATES_PER_IP_PER_HOUR: 20,
  /* wrong codes per address; only FAILURES are counted, a valid code is never refused for other people's wrong ones */
  BAD_CODES_PER_HOUR: 20,
  CHANGES_PAGE: 500,
  /* ---- bytes in and out (Neon Free: 0.5 GB stored, a few GB a month of transfer; written bytes are also WAL and history) ---- */
  /* written, all libraries: per hour and per day */
  INGRESS_PER_HOUR: 64 * MiB,
  INGRESS_PER_DAY: 128 * MiB,
  /* read out of the database, all libraries (G13 doc 7.3: 150 MB a day for the site) */
  EGRESS_PER_HOUR: 64 * MiB,
  EGRESS_PER_DAY: 150 * MiB,
  /* the part of each of those one library, and one creating address (its libraries together), may use */
  BUDGET_SHARE: 0.25,
  /* what one answer of GET items holds of bodies (the rest is "deferred": asked again) */
  READ_BODY_CAP: 6 * MiB,
  /* ---- bodies ---- */
  PUT_BODY: 6 * MiB,
  PUT_DRAIN: 8 * MiB,
  SMALL_BODY: 4 * 1024,
  BODY_TOTAL_MS: 60 * 1000,
  BODY_IDLE_MS: 10 * 1000,
  /* bodies of a PUT being RECEIVED at once: one per library, one per address, this many for the site. A body that is being received holds the bytes that have come, no more, so
     this ceiling can be larger than the one below; but a sender that stalls holds its place until the body's own deadline (60 s), so it is not made small either. */
  PUTS_AT_ONCE: 8,
  /* ... and the items being UNPACKED and checked at once (inflate, the structure scan, JSON.parse of up to 8 MB: a few tens of MB of heap each). This step cannot be stalled by
     a sender: it starts when the body is whole and ends in milliseconds. */
  PROCESS_AT_ONCE: 2,
  /* answers that carry bodies being made at once (up to READ_BODY_CAP of them, as base64 JSON, a few times that in heap) */
  READS_AT_ONCE: 6,
  /* ... a place is held until the answer has been SENT (a reader that takes it a byte at a time holds the memory of the answer for as long as it does), and at most this long */
  READ_HOLD_MS: 120 * 1000,
  /* changes waiting for the one writer at a time */
  WRITE_QUEUE_MAX: 24,
  /* a call of the store that has not answered in this long is a failed call (503 `store`): a hung connection must not hold a request, or the one writer, for ever. The Postgres store's
     queries have their own, shorter time-out (server.js: PPP_SYNC_QUERY_MS, 10 s), which also drops the connection that hung */
  STORE_TIMEOUT_MS: 15 * 1000
};

function configFrom(env, over) {
  const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return Object.assign({
    totalBytes: int(env.PPP_SYNC_TOTAL_MB, LIMITS.TOTAL_BYTES / MiB, 4, 400) * MiB,
    libBytes: LIMITS.LIB_BYTES,
    maxLibs: LIMITS.MAX_LIBS,
    libRows: LIMITS.LIB_ROWS,
    siteRows: LIMITS.SITE_ROWS,
    addressBytes: LIMITS.ADDRESS_BYTES,
    keepMs: int(env.PPP_SYNC_KEEP_DAYS, LIMITS.KEEP_MS / DAY, 14, 730) * DAY,
    ingressPerHour: int(env.PPP_SYNC_INGRESS_MB_HOUR, LIMITS.INGRESS_PER_HOUR / MiB, 1, 4096) * MiB,
    ingressPerDay: int(env.PPP_SYNC_INGRESS_MB_DAY, LIMITS.INGRESS_PER_DAY / MiB, 1, 65536) * MiB,
    egressPerHour: int(env.PPP_SYNC_EGRESS_MB_HOUR, LIMITS.EGRESS_PER_HOUR / MiB, 1, 4096) * MiB,
    egressPerDay: int(env.PPP_SYNC_EGRESS_MB_DAY, LIMITS.EGRESS_PER_DAY / MiB, 1, 65536) * MiB,
    share: LIMITS.BUDGET_SHARE,
    bodyTotalMs: LIMITS.BODY_TOTAL_MS,
    bodyIdleMs: LIMITS.BODY_IDLE_MS,
    putsAtOnce: LIMITS.PUTS_AT_ONCE,
    processAtOnce: LIMITS.PROCESS_AT_ONCE,
    readsAtOnce: LIMITS.READS_AT_ONCE,
    readHoldMs: LIMITS.READ_HOLD_MS,
    storeTimeoutMs: LIMITS.STORE_TIMEOUT_MS
  }, over || {});
}

function httpError(status, message, code, extra) {
  const e = new Error(message);
  e.http = { status: status, code: code, extra: extra };
  return e;
}

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest();
const DUMMY_HASH = sha256('no such library');

/* ---- the code of a library: 64 lowercase hex (256 random bits), sent as X-PPP-Lib; nothing else is a code ---- */
const LIB_HEADER = 'x-ppp-lib';
/* the RECOVERY code: a second secret made with the library and shown once (the page puts it in the backup file and on the sheet with the QR code). It can do one thing: give the
   library a new code (POST /api/libs/recover), for the person whose answer to a change of code was lost, or who has lost the code but kept the backup. It reads and writes no item.
   Only its hash is stored, and it is a master secret like the code: whoever has it can take the library over, so it is kept somewhere else than the code. */
const RECOVERY_HEADER = 'x-ppp-recovery';
const CODE_RE = /^[0-9a-f]{64}$/;
const LIB_PREFIX = 'lib_';
/* domain-separated: no other secret of the site (a PC link's code, a guest key: also 64 hex) hashes to a library */
const codeHash = code => sha256('ppp-lib-v1:' + code);
const libIdOf = hash => LIB_PREFIX + hash.toString('hex').slice(0, 22);
/* a short, NON-SECRET name of a library, to recognise it in the page: the last 6 hex of its id (itself a one-way hash of the code) */
const tagOfId = id => (/^lib_[0-9a-f]{22}$/.test(String(id)) ? String(id).slice(-6) : null);
const recoveryHashOf = code => sha256('ppp-lib-recovery-v1:' + code);
/* what the recovery codes are indexed by in memory: 22 hex of their hash (the whole hash is compared) */
const recoveryKeyOf = hash => hash.toString('hex').slice(0, 22);
function newLibrary() {
  const code = crypto.randomBytes(32).toString('hex');
  const hash = codeHash(code);
  const recovery = crypto.randomBytes(32).toString('hex');
  return { code: code, hash: hash, id: libIdOf(hash), recovery: recovery, recoveryHash: recoveryHashOf(recovery) };
}

/* the keys of items: one song ('song:' + its id) or the progress across songs ('state') */
const KEY_RE = /^(?:state|song:[A-Za-z0-9_.:-]{1,64})$/;
const DEVICE_RE = /^[0-9a-f]{16}$/;
const HASH_RE = /^[A-Za-z0-9_-]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const B64_ITEM_MAX = Math.ceil(LIMITS.ITEM_GZIP_MAX / 3) * 4 + 4;

/* the top-level fields of a song item (G13-D6: the card, the packed Score, that song's progress, the graph when the device has it). An allowlist, so that an item is a song and
   not a place for anything: the page (G13-S1) adds a field here with its test. `graph` is accepted and opaque (G13-S2 gives it a shape). */
const SONG_FIELDS = Object.freeze(['v', 'card', 'score', 'progress', 'graph', 'scoreHash', 'savedAt']);
const STATE_KEYS_MAX = 64;
const NOTES_MAX = 100000;
const ITEM_DEPTH = 24;

/* a score is one: measures and notes as arrays (a packed note is a row, an array, too) - the rule of server.js's validScore, which every share goes through */
function validScore(s) {
  const isObj = x => !!x && typeof x === 'object';
  return !!(s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.measures) && s.measures.length
    && s.measures.length <= 5000 && Array.isArray(s.notes) && s.notes.length <= NOTES_MAX
    && s.measures.every(isObj) && s.notes.every(isObj));
}
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* the shapes a body may have, counted as it arrives (before anything is parsed) */
const SHAPES = Object.freeze({
  small: Object.freeze({ tokens: 64, containers: 8, depth: 6 }),
  /* {device, items: [{key, baseRev, hash, body} x up to 25]} */
  put: Object.freeze({ tokens: 2 * LIMITS.KEYS_PER_BATCH * 8 + 64, containers: LIMITS.KEYS_PER_BATCH + 8, depth: 4 })
});
/* what a decompressed item may have: tokens up to its bytes (a comma is a byte), a container per 16 bytes at the most (a real packed score has one per 58 bytes or more; one
   that carries the real scoregraph, 34-36 - G13-S2 must re-check this number first), nesting to ITEM_DEPTH. JSON.parse of `[{},{},...]` takes 22 bytes of heap per 3 of body. */
const itemShape = bytes => ({ tokens: bytes, containers: Math.max(256, Math.floor(bytes / 16)), depth: ITEM_DEPTH });

const iso = t => (t ? new Date(t).toISOString() : null);

function create(deps) {
  const store = deps.store;
  const now = deps.now || Date.now;
  const C = configFrom(deps.env || process.env, deps.config);
  const logError = deps.logError || (() => {});
  const L = LIMITS;
  const R = SS.ROW_OVERHEAD;

  /* ----- the libraries, in memory ----- */
  const libs = new Map();          /* id -> library (revoked ones too, until they are purged) */
  /* A library's `key` is what its limiters and budgets are held under. It is NOT its id: the id is derived from the code, so a new code is a new id, and a limiter held under the
     id would be made whole by changing the code (5 times an hour, each time with a fresh 240 writes). The key is the id of the first library of the chain of new codes. */
  const rotatedTo = new Map();     /* old id -> id of the library that took its place (so the old code is told "rotated", not "wrong") */
  const recoveryIndex = new Map(); /* recoveryKeyOf(its hash) -> id of the live library it belongs to */
  const ipKey = crypto.createHmac('sha256', String(deps.ipSecret || crypto.randomBytes(32).toString('hex'))).update('ppp-sync-address').digest();
  const tagOf = ip => crypto.createHmac('sha256', ipKey).update(homeJobs.addrKey(ip)).digest('hex').slice(0, 16);
  let loaded = false, loading = null, lastPurge = 0, orphansDue = false, loadEpoch = 0;
  let disabledWhy = null;
  const stats = { loads: 0 };
  /* the window the hourly line reports: counted in memory, one number each, nothing identifying */
  let win = freshWindow();
  function freshWindow() {
    return { libsMade: 0, itemsWritten: 0, itemsDeleted: 0, itemsRead: 0, bytesIn: 0, bytesOut: 0, conflicts: 0, purgedLibs: 0, purgedTombs: 0, requests: 0,
      refused: { badCode: 0, crossSite: 0, tooMany: 0, quota: 0, busy: 0, budget: 0, share: 0, slow: 0, shape: 0, tooLarge: 0, badItem: 0, store: 0, other: 0 } };
  }

  const limiters = {
    badCodes: guestShare.slidingWindow(L.BAD_CODES_PER_HOUR, HOUR, now),
    writeReq: guestShare.slidingWindow(L.WRITE_REQUESTS_PER_HOUR, HOUR, now),
    writeReqIp: guestShare.slidingWindow(L.WRITE_REQUESTS_PER_IP_PER_HOUR, HOUR, now),
    writes: guestShare.slidingWindow(L.WRITES_PER_HOUR, HOUR, now),
    deletes: guestShare.slidingWindow(L.DELETES_PER_HOUR, HOUR, now),
    changesSql: guestShare.slidingWindow(L.CHANGES_SQL_PER_HOUR, HOUR, now),
    changesSqlIp: guestShare.slidingWindow(L.CHANGES_SQL_PER_IP_PER_HOUR, HOUR, now),
    readItems: guestShare.slidingWindow(L.READ_ITEMS_PER_HOUR, HOUR, now),
    rotates: guestShare.slidingWindow(L.ROTATES_PER_HOUR, HOUR, now),
    rotatesIp: guestShare.slidingWindow(L.ROTATES_PER_IP_PER_HOUR, HOUR, now)
  };
  /* n hits at once, or none (a window records one hit per take) */
  function takeN(win_, key, n) {
    let got = 0;
    for (; got < n; got++) if (!win_.take(key)) break;
    if (got === n) return true;
    for (let i = 0; i < got; i++) win_.release(key);
    return false;
  }
  const giveN = (win_, key, n) => { for (let i = 0; i < n; i++) win_.release(key); };

  /* ----- the places for a body: one per library, one per address, a small ceiling for the site ----- */
  const slots = { site: 0, by: new Map() };
  function takeSlot(libId, address) {
    const kl = 'l:' + libId, ka = 'a:' + address;
    if ((slots.by.get(kl) | 0) > 0) throw httpError(429, 'A change from this library is being sent already. Wait for it.', 'in-flight', { retryAfter: 10 });
    if ((slots.by.get(ka) | 0) > 0) throw httpError(503, 'Another change is being sent from this network right now. Try again in a moment.', 'busy', { retryAfter: 10 });
    if (slots.site >= C.putsAtOnce) throw httpError(503, 'Other changes are being sent right now. Try again in a moment.', 'busy', { retryAfter: 10 });
    slots.site++; slots.by.set(kl, 1); slots.by.set(ka, 1);
    let given = false;
    return () => { if (given) return; given = true; slots.site--; slots.by.delete(kl); slots.by.delete(ka); };
  }

  /* the unpacking of items, a few at a time (FIFO; the places above bound how many wait): the token is handed to the next waiter, never given back first */
  let processing = 0, processingPeak = 0;
  const processWaiters = [];
  async function heavy(fn) {
    if (processing >= C.processAtOnce) await new Promise(r => processWaiters.push(r)); else { processing++; if (processing > processingPeak) processingPeak = processing; }
    try { return await fn(); } finally { const w = processWaiters.shift(); if (w) w(); else processing--; }
  }
  let readsNow = 0;

  /* ----- the budgets (bytes) the site writes and reads: held three ways, as G12-5's ----- */
  const byteWindow = homeJobs.byteWindow;
  const budget = {
    in: { hour: byteWindow(C.ingressPerHour, HOUR), day: byteWindow(C.ingressPerDay, DAY), owners: new Map() },
    out: { hour: byteWindow(C.egressPerHour, HOUR), day: byteWindow(C.egressPerDay, DAY), owners: new Map() }
  };
  const ownerKeys = lib => (lib.ipTag ? ['l:' + lib.key, 'a:' + lib.ipTag] : ['l:' + lib.key]);
  function ownerWindows(kind, key) {
    const b = budget[kind];
    let w = b.owners.get(key);
    if (!w) {
      w = { hour: byteWindow(Math.floor(b.hour.limit * C.share), HOUR), day: byteWindow(Math.floor(b.day.limit * C.share), DAY) };
      b.owners.set(key, w);
    }
    return w;
  }
  const windowsOf = (kind, lib) => {
    const b = budget[kind], out = [b.hour, b.day];
    ownerKeys(lib).forEach(k => { const w = ownerWindows(kind, k); out.push(w.hour, w.day); });
    return out;
  };
  /* null when `bytes` more may be taken now; 'site' when the site's own budget has not that much left; 'share' when this library's or its address's has not */
  function budgetWhy(kind, t, lib, bytes) {
    const b = budget[kind];
    if (Math.min(b.hour.left(t), b.day.left(t)) < bytes) return 'site';
    for (const k of ownerKeys(lib)) {
      const w = ownerWindows(kind, k);
      if (Math.min(w.hour.left(t), w.day.left(t)) < bytes) return 'share';
    }
    return null;
  }
  const budgetAdd = (kind, t, lib, bytes) => { windowsOf(kind, lib).forEach(w => w.add(t, bytes)); };
  function budgetWait(kind, t, lib, bytes) {
    let s = 60;
    windowsOf(kind, lib).forEach(w => { if (w.left(t) < bytes) s = Math.max(s, w.wait(t)); });
    return s;
  }
  function budgetError(why, kind, t, lib, bytes) {
    const wait = budgetWait(kind, t, lib, bytes);
    const what = kind === 'in' ? 'take in' : 'send';
    if (why === 'site') return httpError(503, 'The site has ' + (kind === 'in' ? 'taken in' : 'sent') + ' as many songs as it may for now. Try again later.', 'budget', { retryAfter: wait });
    return httpError(429, 'This library, or this network, has used its share of what the site may ' + what + ' for now. Try again in a while.', 'share', { retryAfter: wait });
  }

  /* ----- the data, in memory and from the database ----- */
  function fill(data) {
    /* a library being made right now (its row is not in the database yet) is not in what was read: it must not be lost to a re-read */
    const making = Array.from(libs.values()).filter(l => l.writing);
    libs.clear(); rotatedTo.clear(); recoveryIndex.clear(); loadEpoch++;
    (data.libs || []).forEach(l => {
      if (!l || typeof l.id !== 'string' || l.id.slice(0, 4) !== LIB_PREFIX) return;
      const hash = Buffer.from(String(l.hash), 'hex');
      if (hash.length !== 32) return;
      const revoked = !!l.revokedAt;
      libs.set(l.id, { id: l.id, key: l.id, hash: hash, createdAt: l.createdAt || 0, lastUsedAt: l.lastUsedAt || l.createdAt || 0, persistedAt: l.lastUsedAt || l.createdAt || 0,
        ipTag: l.ipTag || '', revokedAt: l.revokedAt || 0, rotatedFrom: l.rotatedFrom || '',
        bytes: revoked ? 0 : l.bytes | 0, items: revoked ? 0 : l.items | 0, tombs: revoked ? 0 : l.tombs | 0, maxRev: l.maxRev | 0, oldestTomb: revoked ? 0 : ((data.tombs || {})[l.id] || 0), writing: false,
        purgedThrough: l.purgedThrough | 0, recoveryHash: l.recoveryHash && /^[0-9a-f]{64}$/.test(l.recoveryHash) ? Buffer.from(l.recoveryHash, 'hex') : null });
      if (l.rotatedFrom) rotatedTo.set(l.rotatedFrom, l.id);
      const made = libs.get(l.id);
      if (!revoked && made.recoveryHash) recoveryIndex.set(recoveryKeyOf(made.recoveryHash), l.id);
    });
    making.forEach(l => { if (!libs.has(l.id)) libs.set(l.id, l); });
    /* the key of a library that was made by changing a code is the key of the one it came from (as far back as the rows go) */
    libs.forEach(l => { let k = l, guard = 0; while (k.rotatedFrom && libs.has(k.rotatedFrom) && guard++ < 1000) k = libs.get(k.rotatedFrom); l.key = k.key || k.id; });
    if ((data.orphanItems | 0) > 0) orphansDue = true;
  }
  /* A call of the store that has not answered in STORE_TIMEOUT_MS is a failed call: a hung connection must not hold a request - or the one writer - for ever. The call itself is not
     cancelled here (the Postgres store's own query time-out drops the connection that hung); whatever it does when it ends is read back by the next request (staleAfterFailure). */
  function guarded(p) {
    let timer = null;
    const t = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('the store did not answer in time'), { storeTimeout: true })), C.storeTimeoutMs); });
    return Promise.race([p, t]).then(v => { clearTimeout(timer); return v; }, e => { clearTimeout(timer); throw e; });
  }
  /* The one read of a boot. Shared by every request that arrives meanwhile; a failure is not remembered (the next request tries again). */
  async function ensureLoaded() {
    if (loaded) return;
    if (!loading) {
      loading = guarded(store.loadAll()).then(async data => {
        fill(data); loaded = true; stats.loads++;
        /* the database is awake for this read anyway: what ran out goes now (a statement only if there is something) */
        await purgeIfDue(now(), true);
      }).finally(() => { loading = null; });
    }
    await loading;
  }

  /* ----- who is asking ----- */
  /* A browser request must come from this site: a page of another origin cannot send the custom header at all (CORS is closed, so its preflight fails), and an Origin that is
     not this site is refused here as well, for reads as well as writes, BEFORE the code is looked at. */
  function sameSite(req) {
    const origin = req.headers.origin;
    if (origin == null) return true;
    try { return !!req.headers.host && new URL(String(origin)).host === req.headers.host; } catch (e) { return false; }
  }
  function requireSameSite(req) {
    if (!sameSite(req)) throw httpError(403, 'That request did not come from this site.', 'cross-site');
  }
  const addressOf = req => homeJobs.addrKey(deps.clientIp(req) || 'unknown');
  /* a wrong code is counted against the address, and past BAD_CODES_PER_HOUR the answer to a failure is 429; a valid code is never refused for other people's wrong ones */
  function badCode(req) {
    if (!limiters.badCodes.take(addressOf(req))) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });
    return httpError(401, 'That library code is not valid.', 'bad-code');
  }
  /* what a request that held a valid code is told when the library is no longer there: its code was rotated (the new one is to be entered), or it was deleted; neither is a wrong
     code, so neither is counted */
  function goneError(id) {
    const l = libs.get(id);
    if (l && l.revokedAt) {
      if (rotatedTo.has(id)) return httpError(401, 'This library has a new code. Enter the new one.', 'rotated');
      return httpError(401, 'This library was deleted.', 'deleted');
    }
    return httpError(401, 'That library code is not valid.', 'bad-code');
  }
  /* the library a request names with X-PPP-Lib, or an error. No header: 401 `no-lib` (nothing was guessed, so nothing is counted). A header that is not 64 lowercase hex, or is
     not a library's code: a failure (counted). The code of a library that was rotated or deleted is a code that WAS right: told so, not counted. */
  async function requireLib(req) {
    requireSameSite(req);
    const raw = req.headers[LIB_HEADER];
    if (raw === undefined) throw httpError(401, 'No library code was sent.', 'no-lib');
    if (typeof raw !== 'string' || !CODE_RE.test(raw)) throw badCode(req);
    await ensureLoaded();
    const got = codeHash(raw);
    const rec = libs.get(libIdOf(got)) || null;
    const want = rec ? rec.hash : DUMMY_HASH;
    const same = want.length === got.length && crypto.timingSafeEqual(want, got);
    if (!same || !rec || rec.writing) throw badCode(req);
    if (rec.revokedAt) {
      if (rotatedTo.has(rec.id)) throw httpError(401, 'This library has a new code. Enter the new one.', 'rotated');
      throw httpError(401, 'This library was deleted.', 'deleted');
    }
    const t = now();
    rec.lastUsedAt = t;
    await persistUse(rec, t);
    const cur = libs.get(rec.id);
    if (!cur || cur.revokedAt) throw goneError(rec.id);
    return cur;
  }
  /* the database is told a library was used at most once a TOUCH_MS (a day): the keeping time is months, so a day is exact enough; a request that finds nothing new runs no SQL */
  async function persistUse(lib, t) {
    if (lib.revokedAt || t - lib.persistedAt < L.TOUCH_MS) return;
    const was = lib.persistedAt;
    lib.persistedAt = t;
    try { await guarded(store.touchLib(lib.id, t)); } catch (e) { lib.persistedAt = Math.max(was, t - L.TOUCH_MS + 60 * 1000); logError(e); }
  }
  const keptUntil = lib => iso(lib.lastUsedAt + C.keepMs);

  /* ----- sums over the libraries (at most a couple of thousand rows) ----- */
  const liveLibs = () => { const out = []; libs.forEach(l => { if (!l.revokedAt && !l.writing) out.push(l); }); return out; };
  const siteBytes = () => { let n = 0; libs.forEach(l => { if (!l.revokedAt) n += l.bytes; }); return n; };
  const siteRows = () => { let n = 0; libs.forEach(l => { if (!l.revokedAt) n += l.items + l.tombs; }); return n; };
  const addressBytes = tag => { let n = 0; libs.forEach(l => { if (!l.revokedAt && l.ipTag === tag) n += l.bytes; }); return n; };

  /* ----- one writer at a time: every change of a library is made under this, so the quotas (of the library, of the address, of the site) are exact ----- */
  let writeChain = Promise.resolve(), writeWaiting = 0;
  function exclusive(fn) {
    if (writeWaiting >= L.WRITE_QUEUE_MAX) return Promise.reject(httpError(503, 'Too many changes are being saved right now. Try again in a moment.', 'busy', { retryAfter: 5 }));
    writeWaiting++;
    const prev = writeChain;
    let release;
    writeChain = new Promise(r => { release = r; });
    return prev.then(async () => {
      try { return await guarded(fn()); } catch (e) { if (e && e.storeTimeout) staleAfterFailure(); throw e; } finally { writeWaiting--; release(); }
    });
  }
  /* a failed write may have been made durable (the answer was lost): read it all again at the next request, so the memory is the database's */
  const staleAfterFailure = () => { loaded = false; };
  /* ... and a read of everything that finished while a write was in flight may have read the database before that write: the write's own change to memory is then on records
     that were replaced, so the next request reads it all again (a rare path: it needs a failed write first) */
  const epoch = () => loadEpoch;
  const checkEpoch = e => { if (loadEpoch !== e) loaded = false; };

  /* ----- the purge ----- */
  function libExpired(l, t) {
    if (l.writing) return false;
    if (l.revokedAt) return t - l.revokedAt > L.REVOKED_KEEP_MS;
    const used = Math.max(l.lastUsedAt, l.createdAt);
    if (t - used > C.keepMs) return true;
    return l.items + l.tombs === 0 && t - used > L.EMPTY_KEEP_MS;
  }
  /* Libraries that ran out (with their items) and tombstones past their keeping time leave memory and the database in ONE statement, run only when memory says there is
     something to delete (and then at most every PURGE_EVERY_MS): the boot read, and any request that writes. */
  async function purgeIfDue(t, force) {
    if (!force && t - lastPurge < L.PURGE_EVERY_MS) return;
    lastPurge = t;
    ['in', 'out'].forEach(kind => budget[kind].owners.forEach((w, k) => { if (!w.hour.used(t) && !w.day.used(t)) budget[kind].owners.delete(k); }));
    const dead = [];
    let tombDue = false;
    libs.forEach(l => {
      if (libExpired(l, t)) dead.push(l.id);
      else if (!l.revokedAt && l.oldestTomb && t - l.oldestTomb > L.TOMBSTONE_KEEP_MS) tombDue = true;
    });
    if (dead.length || tombDue) {
      try {
        const r = await guarded(store.purge(dead, tombDue ? t - L.TOMBSTONE_KEEP_MS : null));
        dead.forEach(id => {
          const l = libs.get(id);
          if (l && l.recoveryHash && recoveryIndex.get(recoveryKeyOf(l.recoveryHash)) === id) recoveryIndex.delete(recoveryKeyOf(l.recoveryHash));
          libs.delete(id);
        });
        rotatedTo.forEach((to, from) => { if (!libs.has(from)) rotatedTo.delete(from); });
        (r.updated || []).forEach(u => { const l = libs.get(u.id); if (l) { l.tombs = u.tombs; l.bytes = u.bytes; l.oldestTomb = u.oldestTomb || 0; l.purgedThrough = Math.max(l.purgedThrough | 0, u.purgedThrough | 0); } });
        win.purgedLibs += r.libs | 0; win.purgedTombs += r.tombs | 0;
      } catch (e) { logError(e); }
    }
    if (orphansDue && typeof store.deleteOrphans === 'function') {
      try { await guarded(store.deleteOrphans()); orphansDue = false; } catch (e) { logError(e); }
    }
  }

  /* ----- a body ----- */
  async function readJson(req, limit, drain, shape) {
    const cap = Math.max(drain || 1024 * 1024, limit);
    /* a size announced that is far over the cap is refused before a byte is read */
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > cap) throw httpError(413, 'That is larger than this accepts.', 'too-large', { close: true });
    let raw;
    try { raw = await bodyReader.readBody(req, { limit: limit, drain: cap, shape: shape || SHAPES.small, totalMs: C.bodyTotalMs, idleMs: C.bodyIdleMs }); } catch (e) {
      if (e && e.code === 'SLOW') throw httpError(408, 'That took too long to arrive.', 'slow', { close: true });
      if (e && e.code === 'SHAPE') throw httpError(422, 'That cannot be stored.', 'bad-body');
      if (e && e.code === 'ABORTED') throw httpError(400, 'The request was cut off.', 'aborted', { close: true });
      throw httpError(413, 'That is larger than this accepts.', 'too-large');
    }
    if (!raw.length) return {};
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { throw httpError(400, 'Invalid JSON'); }
    if (!isPlain(body)) throw httpError(422, 'Expected a JSON object.', 'bad-body');
    if (guestShare.inspect(body)) throw httpError(422, 'That cannot be stored.', 'bad-body');
    return body;
  }
  /* routes that take no body are not read: a request that announces one is answered and the connection closed (the body is never held) */
  const announcesBody = req => { const cl = req.headers['content-length']; return (cl !== undefined && Number(cl) !== 0) || req.headers['transfer-encoding'] !== undefined; };
  function noBody(req) {
    if (announcesBody(req)) throw httpError(400, 'This request takes no body.', 'no-body-expected', { close: true });
  }
  const reply = (res, status, body, headers) => deps.send(res, status, body, Object.assign({ 'Cache-Control': 'no-store' }, headers));

  const libView = lib => ({ tag: tagOfId(lib.id), bytes: lib.bytes, items: lib.items, tombs: lib.tombs, capBytes: C.libBytes, maxItems: C.libRows, keptUntil: keptUntil(lib) });
  const metaView = m => {
    const o = { key: m.key, rev: m.rev, deleted: !!m.deleted, hash: m.hash || '', bytes: m.bytes | 0, device: m.device || '', updatedAt: iso(m.updatedAt) };
    if (m.deleted) o.deletedAt = iso(m.deletedAt);
    return o;
  };

  /* ================= POST /api/libs : make a library (no code is needed: this makes one) ================= */
  /* seconds until this address (its keyed tag) may make another library, or 0. Counted from the libraries themselves, so a restart does not forget them; a library that was
     rotated into (rotatedFrom) is not a new library, a deleted one counts for REVOKED_KEEP_MS (making and deleting is no way round the limit). */
  function libWait(tag, t) {
    let oldestHour = 0, oldestDay = 0, hour = 0, day = 0;
    libs.forEach(l => {
      if (l.ipTag !== tag || l.rotatedFrom) return;
      if (t - l.createdAt < HOUR) { hour++; if (!oldestHour || l.createdAt < oldestHour) oldestHour = l.createdAt; }
      if (t - l.createdAt < DAY) { day++; if (!oldestDay || l.createdAt < oldestDay) oldestDay = l.createdAt; }
    });
    if (hour < L.LIBS_PER_IP_PER_HOUR && day < L.LIBS_PER_IP_PER_DAY) return 0;
    const wait = Math.max(hour >= L.LIBS_PER_IP_PER_HOUR ? oldestHour + HOUR - t : 0, day >= L.LIBS_PER_IP_PER_DAY ? oldestDay + DAY - t : 0);
    return Math.max(60, Math.min(86400, Math.ceil(wait / 1000)));
  }
  function siteLibWait(t) {
    let n = 0, oldest = 0;
    libs.forEach(l => { if (l.rotatedFrom) return; if (t - l.createdAt < HOUR) { n++; if (!oldest || l.createdAt < oldest) oldest = l.createdAt; } });
    if (n < L.LIBS_PER_HOUR) return 0;
    return Math.max(60, Math.min(3600, Math.ceil((oldest + HOUR - t) / 1000)));
  }

  async function createLib(req, res) {
    requireSameSite(req);
    await readJson(req, L.SMALL_BODY);
    await ensureLoaded();
    const t = now();
    await purgeIfDue(t);
    const tag = tagOf(deps.clientIp(req) || 'unknown');
    const wait = libWait(tag, t);
    if (wait) throw httpError(429, 'Too many libraries were made from here just now. Try again later.', 'too-many', { retryAfter: wait });
    const siteWait = siteLibWait(t);
    if (siteWait) throw httpError(429, 'Too many libraries were made on this site just now. Try again later.', 'too-many', { retryAfter: siteWait });
    let live = 0;
    libs.forEach(l => { if (!l.revokedAt) live++; });
    if (live >= C.maxLibs) throw httpError(503, 'The site holds as many song libraries as it may for now. Try again later.', 'busy');
    const made = newLibrary();
    if (libs.has(made.id)) throw httpError(503, 'Could not make a library just now. Try again in a minute.', 'store');
    const lib = { id: made.id, key: made.id, hash: made.hash, createdAt: t, lastUsedAt: t, persistedAt: t, ipTag: tag, revokedAt: 0, rotatedFrom: '', bytes: 0, items: 0, tombs: 0, maxRev: 0, oldestTomb: 0, writing: true,
      purgedThrough: 0, recoveryHash: made.recoveryHash };
    libs.set(lib.id, lib);        /* the place is taken before anything is awaited: requests at the same moment count it */
    let ok = false;
    try { ok = await guarded(store.createLib({ id: lib.id, recoveryHash: made.recoveryHash.toString('hex'), hash: made.hash.toString('hex'), createdAt: t, ipTag: tag }, C.maxLibs)); } catch (e) { libs.delete(lib.id); throw e; }
    if (!ok) { libs.delete(lib.id); throw httpError(503, 'The site holds as many song libraries as it may for now. Try again later.', 'busy'); }
    lib.writing = false;
    recoveryIndex.set(recoveryKeyOf(made.recoveryHash), lib.id);
    win.libsMade++;
    /* the only time the code and the recovery code are ever shown */
    reply(res, 201, { id: lib.id, code: made.code, recovery: made.recovery, tag: tagOfId(lib.id), createdAt: iso(t), keptUntil: keptUntil(lib) });
  }

  /* ================= GET /api/sync/changes?since=<rev> ================= */
  function parseRev(text, what) {
    if (text == null || text === '') return 0;
    if (!/^\d{1,15}$/.test(String(text))) throw httpError(422, what + ' must be a whole number.', 'bad-rev');
    return Number(text);
  }
  async function changes(req, res, url) {
    const lib = await requireLib(req);
    noBody(req);
    const since = parseRev(url.searchParams.get('since'), 'since');
    const ip = addressOf(req);
    /* A poll that has to ask the database takes a place in the hour of the library and of the address (an idle poll asks nothing and takes none). */
    let took = false;
    const takeSql = () => {
      if (took) return;
      if (!limiters.changesSql.take(lib.key)) throw httpError(429, 'This library asked for changes too often. Try again in a little while.', 'too-many', { retryAfter: 600 });
      if (!limiters.changesSqlIp.take(ip)) { limiters.changesSql.release(lib.key); throw httpError(429, 'Too many requests from this network. Try again in a little while.', 'too-many', { retryAfter: 600 }); }
      took = true;
    };
    const giveSql = () => { if (took) { limiters.changesSql.release(lib.key); limiters.changesSqlIp.release(ip); took = false; } };
    /* THE REVISION THIS ANSWER IS ABOUT is read once, here, before anything is awaited. A write that commits while the rows are being fetched moves the library's revision on, and an
       answer that said "go on from the revision the library has NOW" would hand a device a position past rows it was never given (the reviewer's reproduction: items 1 and 2 are
       listed, another device writes 3, and the answer says nextSince 3). So the position is the highest of this revision and of the last row that is listed, never a number read later. */
    let rev0 = lib.maxRev;
    if (since > rev0) {
      /* a device that says it is AHEAD of the library: the library's own record is read once before it is told so (the cache may be the one that is behind: a restored database, a
         second process that wrote), and a device that is told "reset" forgets what it knows of the library */
      takeSql();
      const st = await guarded(store.libState(lib.id));
      if (st && st.found && st.live) {
        if (st.maxRev > lib.maxRev) { lib.maxRev = st.maxRev; lib.bytes = st.bytes; lib.items = st.items; lib.tombs = st.tombs; }
        if (st.purgedThrough > lib.purgedThrough) lib.purgedThrough = st.purgedThrough;
      }
      rev0 = lib.maxRev;
    }
    /* nothing newer than the device has: answered from memory, no statement */
    if (since >= rev0) { giveSql(); return reply(res, 200, Object.assign({ items: [], more: false, deletions: 0, maxRev: rev0, library: libView(lib) }, since > rev0 ? { reset: true } : {})); }
    takeSql();
    /* the rows are bytes out of the database like the bodies are: the budget is looked at BEFORE the database is asked, and charged (by what was serialized) after */
    const t0 = now();
    const why = budgetWhy('out', t0, lib, 1);
    if (why) { giveSql(); throw budgetError(why, 'out', t0, lib, 1); }
    const rows = await guarded(store.changes(lib.id, since, L.CHANGES_PAGE + 1));
    const more = rows.length > L.CHANGES_PAGE;
    const page = more ? rows.slice(0, L.CHANGES_PAGE) : rows;
    /* `deletions` is the number of tombstones in this answer: a device that is told more than a few at once asks before removing songs (G13 doc 7.5) */
    const deletions = page.filter(m => m.deleted).length;
    const last = page.length ? page[page.length - 1].rev : since;
    const top = Math.max(rev0, last);
    const out = { items: page.map(metaView), more: more, nextSince: more ? last : top, deletions: deletions, maxRev: top, library: libView(lib) };
    /* tombstones older than the keeping time are gone: a device whose last-seen revision is below the highest one that was purged may have missed a deletion, and must ask the person
       before it pushes what it has (G13 doc 7.5, "a device that was away") */
    if (since < lib.purgedThrough) { out.tooOld = true; out.purgedThrough = lib.purgedThrough; }
    const text = JSON.stringify(out);
    const size = Buffer.byteLength(text);
    budgetAdd('out', now(), lib, size);
    win.bytesOut += size;
    reply(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  /* ================= GET /api/sync/items?keys=a,b,c ================= */
  function parseKeys(text) {
    if (!text) throw httpError(422, 'Name the items to read with ?keys=.', 'no-keys');
    const keys = String(text).split(',');
    if (keys.length > L.KEYS_PER_BATCH) throw httpError(422, 'At most ' + L.KEYS_PER_BATCH + ' items at a time.', 'too-many-items');
    const seen = new Set();
    keys.forEach(k => {
      if (!KEY_RE.test(k)) throw httpError(422, 'That is not the name of an item.', 'bad-key');
      if (seen.has(k)) throw httpError(422, 'An item is named twice.', 'dup-key');
      seen.add(k);
    });
    return keys;
  }
  async function readItems(req, res, url) {
    const lib = await requireLib(req);
    noBody(req);
    const keys = parseKeys(url.searchParams.get('keys'));
    /* answers that carry bodies are made a few at a time (each is up to READ_BODY_CAP as bytes, base64 and JSON): past that the answer is "busy", before anything is taken */
    if (readsNow >= C.readsAtOnce) throw httpError(503, 'Other songs are being sent right now. Try again in a moment.', 'busy', { retryAfter: 5 });
    readsNow++;
    let freed = false, timer = null;
    const free = () => { if (freed) return; freed = true; readsNow--; clearTimeout(timer); res.removeListener('close', free); };
    /* the place is given back when the answer is out (or the connection is gone); a reader that is slower than READ_HOLD_MS is cut */
    timer = setTimeout(() => { free(); try { res.destroy(); } catch (e) { /* gone */ } }, C.readHoldMs);
    res.once('close', free);
    try { return await readItemsNow(res, lib, keys); } catch (e) { free(); throw e; }
  }
  async function readItemsNow(res, lib, keys) {
    const t0 = now();
    /* the item budget is taken before the database is asked (a refused request costs it nothing), and not given back: the keys were looked up */
    if (!takeN(limiters.readItems, lib.key, keys.length)) throw httpError(429, 'This library has read as many songs as it may this hour. Try again in a while.', 'too-many', { retryAfter: 600 });
    /* the bytes: a library, its address and the site each have an hour and a day; the one answer that crosses a budget is served (at most one: the look and the reservation below have no await between them) */
    const why = budgetWhy('out', t0, lib, 1);
    if (why) { giveN(limiters.readItems, lib.key, keys.length); throw budgetError(why, 'out', t0, lib, 1); }
    /* THE WORST THIS ANSWER CAN WEIGH IS RESERVED BEFORE THE STORE IS ASKED and the difference given back after: six answers at once all passing the look above before any of them
       was counted (the reviewer measured 34.5 MB served against a 2 MB share) is what counting afterwards did. The first reservation fills the window, the others are refused. */
    const worst = Math.max(1, Math.min(L.READ_BODY_CAP, lib.bytes, keys.length * L.ITEM_GZIP_MAX));
    budgetAdd('out', t0, lib, worst);
    const settle = actual => { if (worst > actual) windowsOf('out', lib).forEach(w => w.sub(t0, worst - actual, now())); };
    let rows;
    try { rows = await guarded(store.getItems(lib.id, keys, L.READ_BODY_CAP)); } catch (e) { settle(0); throw e; }
    let bytes = 0;
    const items = rows.map(r => {
      const o = metaView(r);
      if (r.body) { o.body = r.body.toString('base64'); bytes += r.body.length; }
      else if (r.deferred) o.deferred = true;
      return o;
    });
    const got = new Set(rows.map(r => r.key));
    settle(bytes);
    win.itemsRead += rows.length; win.bytesOut += bytes;
    reply(res, 200, { items: items, missing: keys.filter(k => !got.has(k)), maxRev: lib.maxRev });
  }

  /* ================= PUT /api/sync/items ================= */
  const inflate = (buf, max) => new Promise((resolve, reject) => { zlib.gunzip(buf, { maxOutputLength: max }, (err, out) => (err ? reject(err) : resolve(out))); });

  /* the plain bytes of one item -> { ok: true } or { ok: false, code, error }: its structure is counted before it is parsed (the amplification), then it is parsed and its shape
     is the shape of that kind of item */
  function checkItem(key, plain) {
    const bad = (code, error) => ({ ok: false, status: 422, code: code, error: error });
    const g = H.jsonGuard(itemShape(plain.length));
    if (g.push(plain) === 'shape') return bad('bad-item', 'The structure of "' + key + '" is not that of a song.');
    let v;
    try { v = JSON.parse(plain.toString('utf8')); } catch (e) { return bad('bad-item', '"' + key + '" is not JSON.'); }
    if (!isPlain(v)) return bad('bad-item', '"' + key + '" is not an object.');
    if (guestShare.inspect(v, ITEM_DEPTH)) return bad('bad-item', '"' + key + '" has text or nesting that cannot be stored.');
    if (key === 'state') {
      if (Object.keys(v).length > STATE_KEYS_MAX) return bad('bad-item', 'The progress has more fields than it should.');
      return { ok: true };
    }
    const unknown = Object.keys(v).filter(k => SONG_FIELDS.indexOf(k) < 0);
    if (unknown.length) return bad('bad-item', '"' + key + '" has a field a song does not have (' + unknown[0].slice(0, 40).replace(/[^ -~]/g, '?') + ').');
    if (!validScore(v.score)) return bad('bad-item', '"' + key + '" has no score PPP can read.');
    for (const f of ['card', 'progress', 'graph']) if (v[f] !== undefined && !isPlain(v[f])) return bad('bad-item', 'The ' + f + ' of "' + key + '" is not an object.');
    return { ok: true };
  }

  async function putItems(req, res) {
    const lib = await requireLib(req);
    const ip = addressOf(req);
    /* the work this request costs is counted whatever comes of it (a refused or conflicting request does not make the library's item budget cheaper to spam) */
    if (!limiters.writeReq.take(lib.key)) throw httpError(429, 'This library has saved changes too often. Try again in a little while.', 'too-many', { retryAfter: 600 });
    if (!limiters.writeReqIp.take(ip)) throw httpError(429, 'Too many changes from this network. Try again in a little while.', 'too-many', { retryAfter: 600 });
    const slot = takeSlot(lib.key, ip);
    try { return await putItemsWithSlot(req, res, lib, ip); } finally { slot(); }
  }

  async function putItemsWithSlot(req, res, lib0, ip) {
    let lib = lib0;
    {
      /* what can be refused without the body is refused first: nobody sends megabytes to be told */
      const t0 = now();
      const why = budgetWhy('in', t0, lib, 1);
      if (why) throw budgetError(why, 'in', t0, lib, 1);
      if (lib.writing || lib.revokedAt) throw goneError(lib.id);
    }
    const body = await readJson(req, L.PUT_BODY, L.PUT_DRAIN, SHAPES.put);
    const list = body.items;
    if (!Array.isArray(list) || !list.length) throw httpError(422, 'No items were sent.', 'no-items');
    if (list.length > L.KEYS_PER_BATCH) throw httpError(422, 'At most ' + L.KEYS_PER_BATCH + ' items at a time.', 'too-many-items');
    let device = '';
    if (body.device !== undefined) {
      if (typeof body.device !== 'string' || !DEVICE_RE.test(body.device)) throw httpError(422, 'The device name is not usable.', 'bad-device');
      device = body.device;
    }
    const items = [];
    const seen = new Set();
    let gzBytes = 0;
    for (const it of list) {
      if (!isPlain(it)) throw httpError(422, 'An item is not an object.', 'bad-item');
      if (typeof it.key !== 'string' || !KEY_RE.test(it.key)) throw httpError(422, 'That is not the name of an item.', 'bad-key');
      if (seen.has(it.key)) throw httpError(422, 'An item is named twice.', 'dup-key');
      seen.add(it.key);
      if (typeof it.baseRev !== 'number' || !Number.isInteger(it.baseRev) || it.baseRev < 0 || it.baseRev > 1e15) throw httpError(422, 'baseRev must be a whole number (0 for a new item).', 'bad-rev');
      if (typeof it.hash !== 'string' || !HASH_RE.test(it.hash)) throw httpError(422, 'The hash of an item is not usable.', 'bad-hash');
      if (typeof it.body !== 'string' || !it.body.length) throw httpError(422, 'An item has no body.', 'bad-item');
      if (it.body.length > B64_ITEM_MAX) throw httpError(413, 'An item is larger than ' + (L.ITEM_GZIP_MAX / MiB) + ' MB.', 'item-too-large');
      if (it.body.length % 4 !== 0 || !B64_RE.test(it.body)) throw httpError(422, 'The body of an item is not base64.', 'bad-item');
      const gz = Buffer.from(it.body, 'base64');
      if (gz.length > L.ITEM_GZIP_MAX) throw httpError(413, 'An item is larger than ' + (L.ITEM_GZIP_MAX / MiB) + ' MB.', 'item-too-large');
      /* a gzip stream: its two magic bytes and the deflate method (zlib and raw deflate are not accepted) */
      if (gz.length < 20 || gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 0x08) throw httpError(422, 'The body of "' + it.key + '" is not gzip.', 'bad-gzip');
      gzBytes += gz.length;
      if (gzBytes > L.REQUEST_GZIP_MAX) throw httpError(413, 'These items are more than ' + (L.REQUEST_GZIP_MAX / MiB) + ' MB together.', 'batch-too-large');
      items.push({ key: it.key, base: it.baseRev, hash: it.hash, bytes: gz.length, body: gz, device: device });
    }
    /* the item budgets: taken for the whole batch, given back for what is refused or conflicts */
    if (!takeN(limiters.writes, lib.key, items.length)) throw httpError(429, 'This library has saved as many songs as it may this hour. Try again in a while.', 'too-many', { retryAfter: 600 });
    let held = items.length;
    const giveBack = n => { giveN(limiters.writes, lib.key, n); held -= n; };
    try {
      /* what each item is, decompressed with a hard cap, shaped, before anything is stored */
      await heavy(async () => {
        let inflated = 0;
        for (const it of items) {
          let plain;
          try { plain = await inflate(it.body, Math.max(1, Math.min(L.ITEM_INFLATED_MAX, L.REQUEST_INFLATED_MAX - inflated))); } catch (e) {
            if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw httpError(413, '"' + it.key + '" is larger than ' + (L.ITEM_INFLATED_MAX / MiB) + ' MB when unpacked.', 'item-too-large');
            throw httpError(422, 'The body of "' + it.key + '" is not gzip.', 'bad-gzip');
          }
          inflated += plain.length;
          const c = checkItem(it.key, plain);
          if (!c.ok) throw httpError(c.status, c.error, c.code);
        }
      });
      return await exclusive(async () => {
        /* the library may have been deleted, rotated or purged while the body arrived and was checked: look it up again, by id and hash */
        const cur = libs.get(lib.id);
        if (!cur || cur.revokedAt || !cur.hash.equals(lib.hash)) throw goneError(lib.id);
        lib = cur;
        const t = now();
        await purgeIfDue(t);
        const again = libs.get(lib.id);
        if (!again || again.revokedAt) throw goneError(lib.id);
        lib = again;
        const total = items.reduce((n, it) => n + it.bytes, 0);
        const why = budgetWhy('in', t, lib, total);
        if (why) throw budgetError(why, 'in', t, lib, total);
        const libRoom = C.libBytes - lib.bytes, addrRoom = C.addressBytes - addressBytes(lib.ipTag), siteRoom = C.totalBytes - siteBytes();
        const rowsRoom = Math.min(C.libRows - lib.items - lib.tombs, C.siteRows - siteRows());
        const growthMax = Math.max(0, Math.min(libRoom, addrRoom, siteRoom));
        let r;
        const ep = epoch();
        try { r = await store.putItems(lib.id, items, t, { growthMax: growthMax, rowsRoom: Math.max(0, rowsRoom) }); } catch (e) { staleAfterFailure(); throw e; }
        checkEpoch(ep);
        if (!r.ok) {
          if (r.reason === 'gone') throw goneError(lib.id);
          /* the guards of the store said no (the batch would grow the library past a cap): say which cap, by the room each has */
          if (r.newRows > Math.max(0, rowsRoom)) throw httpError(503, 'This ' + (C.libRows - lib.items - lib.tombs < r.newRows ? 'library holds as many items as it may.' : 'site keeps as many items as it may right now.'), 'quota');
          if (r.growth > libRoom) throw httpError(503, 'This library is full (' + (C.libBytes / MiB) + ' MB). Delete songs to make room.', 'quota');
          if (r.growth > addrRoom) throw httpError(503, 'This network has as many songs stored as the site keeps for it.', 'quota');
          throw httpError(503, 'The site cannot keep more songs right now. Try again later.', 'busy');
        }
        Object.assign(lib, { maxRev: r.maxRev, bytes: r.bytes, items: r.items, tombs: r.tombs, lastUsedAt: t, persistedAt: t });
        if (r.lost && r.lost.length) staleAfterFailure();
        const applied = r.applied.length;
        giveBack(items.length - applied);
        const wrote = items.filter(it => r.applied.some(a => a.key === it.key)).reduce((n, it) => n + it.bytes, 0);
        budgetAdd('in', t, lib, wrote);
        win.itemsWritten += applied; win.bytesIn += wrote; win.conflicts += r.conflicts.length + (r.gone || []).length;
        held = 0;
        /* a key the device has a revision of and the library has no row for (its tombstone was purged) is `gone`: the device must say again, with base 0, that it brings the song back;
           a key that was decided and then lost to another writer (two processes only) is `stale` */
        const conflicts = r.conflicts.map(metaView)
          .concat((r.gone || []).map(k => ({ key: k, rev: 0, deleted: false, hash: '', bytes: 0, device: '', updatedAt: null, gone: true })))
          .concat((r.lost || []).map(k => ({ key: k, rev: 0, deleted: false, hash: '', bytes: 0, device: '', updatedAt: null, stale: true })));
        reply(res, conflicts.length ? 409 : 200, { maxRev: lib.maxRev, applied: r.applied, conflicts: conflicts, library: libView(lib) });
      });
    } catch (e) {
      /* an error: whatever the item budget still holds is given back */
      if (held > 0) giveN(limiters.writes, lib0.key, held);
      throw e;
    }
  }

  /* ================= DELETE /api/sync/items/:key?baseRev=<n> ================= */
  async function deleteItem(req, res, url, rawKey) {
    const lib = await requireLib(req);
    noBody(req);
    let key;
    try { key = decodeURIComponent(rawKey); } catch (e) { throw httpError(422, 'That is not the name of an item.', 'bad-key'); }
    if (!KEY_RE.test(key)) throw httpError(422, 'That is not the name of an item.', 'bad-key');
    const baseText = url.searchParams.get('baseRev');
    if (baseText == null) throw httpError(422, 'baseRev (the revision of the item you saw) is required to delete it.', 'bad-rev');
    const base = parseRev(baseText, 'baseRev');
    const dev = url.searchParams.get('device');
    if (dev != null && !DEVICE_RE.test(dev)) throw httpError(422, 'The device name is not usable.', 'bad-device');
    const ip = addressOf(req);
    if (!limiters.writeReq.take(lib.key)) throw httpError(429, 'This library has saved changes too often. Try again in a little while.', 'too-many', { retryAfter: 600 });
    if (!limiters.writeReqIp.take(ip)) throw httpError(429, 'Too many changes from this network. Try again in a little while.', 'too-many', { retryAfter: 600 });
    if (!limiters.writes.take(lib.key)) throw httpError(429, 'This library has saved as many songs as it may this hour. Try again in a while.', 'too-many', { retryAfter: 600 });
    if (!limiters.deletes.take(lib.key)) { limiters.writes.release(lib.key); throw httpError(429, 'This library has removed as many songs as it may this hour. Try again in a while.', 'too-many', { retryAfter: 600 }); }
    let spent = true;
    const refund = () => { if (!spent) return; spent = false; limiters.writes.release(lib.key); limiters.deletes.release(lib.key); };
    try {
      return await exclusive(async () => {
        const cur = libs.get(lib.id);
        if (!cur || cur.revokedAt || !cur.hash.equals(lib.hash)) throw goneError(lib.id);
        const t = now();
        await purgeIfDue(t);
        let r;
        const ep = epoch();
        try { r = await store.deleteItem(cur.id, key, base, dev || '', t); } catch (e) { staleAfterFailure(); throw e; }
        checkEpoch(ep);
        if (!r.ok) throw goneError(lib.id);
        const target = libs.get(cur.id) || cur;
        Object.assign(target, { maxRev: r.maxRev, bytes: r.bytes, items: r.items, tombs: r.tombs, lastUsedAt: t, persistedAt: t });
        if (r.state === 'deleted') {
          if (!target.oldestTomb) target.oldestTomb = t;
          spent = false;
          win.itemsDeleted++;
          return reply(res, 200, { key: key, rev: r.rev, deleted: true, maxRev: target.maxRev, library: libView(target) });
        }
        refund();
        if (r.state === 'already') return reply(res, 200, { key: key, rev: r.rev, deleted: true, already: true, maxRev: target.maxRev, library: libView(target) });
        if (r.state === 'missing') throw httpError(404, 'That item is not in this library.', 'not-found');
        win.conflicts++;
        return reply(res, 409, { maxRev: target.maxRev, applied: [], conflicts: [metaView(r.meta)], library: libView(target) });
      });
    } catch (e) { refund(); throw e; }
  }

  /* ================= POST /api/libs/me/rotate, POST /api/libs/recover and DELETE /api/libs/me ================= */
  /* the library gets a new code (and, for a recovery, a new recovery code too: it is single use); items, revisions, counters and the keeping time carry over */
  function rotateNow(res, lib, replaceRecovery) {
    return exclusive(async () => {
      const cur = libs.get(lib.id);
      if (!cur || cur.revokedAt || !cur.hash.equals(lib.hash)) throw goneError(lib.id);
      const t = now();
      const made = newLibrary();
      if (libs.has(made.id)) throw httpError(503, 'Could not change the code just now. Try again in a minute.', 'store');
      let ok = false;
      const ep = epoch();
      try { ok = await store.rotateLib(cur.id, { id: made.id, hash: made.hash.toString('hex'), recoveryHash: replaceRecovery ? made.recoveryHash.toString('hex') : null }, t); } catch (e) { staleAfterFailure(); throw e; }
      checkEpoch(ep);
      if (!ok) throw goneError(lib.id);
      const nl = { id: made.id, key: cur.key, hash: made.hash, createdAt: cur.createdAt, lastUsedAt: t, persistedAt: t, ipTag: cur.ipTag, revokedAt: 0, rotatedFrom: cur.id,
        bytes: cur.bytes, items: cur.items, tombs: cur.tombs, maxRev: cur.maxRev, oldestTomb: cur.oldestTomb, writing: false,
        purgedThrough: cur.purgedThrough, recoveryHash: replaceRecovery ? made.recoveryHash : cur.recoveryHash };
      /* the old code is dead from this turn of the event loop on: its holders are told "rotated" */
      Object.assign(cur, { revokedAt: t, bytes: 0, items: 0, tombs: 0, oldestTomb: 0 });
      libs.set(nl.id, nl);
      rotatedTo.set(cur.id, nl.id);
      if (cur.recoveryHash) recoveryIndex.delete(recoveryKeyOf(cur.recoveryHash));
      if (nl.recoveryHash) recoveryIndex.set(recoveryKeyOf(nl.recoveryHash), nl.id);
      reply(res, 201, Object.assign({ id: nl.id, code: made.code, tag: tagOfId(nl.id), createdAt: iso(nl.createdAt), keptUntil: keptUntil(nl), maxRev: nl.maxRev, rotated: true },
        replaceRecovery ? { recovery: made.recovery, recovered: true } : {}));
    });
  }
  /* the places of a change of code: per library and per address, whether it was asked for with the code or with the recovery code */
  async function rotateWithBody(req, res, lib, replaceRecovery) {
    const ip = addressOf(req);
    if (!limiters.rotates.take(lib.key)) throw httpError(429, 'The code of this library was changed too often. Try again later.', 'too-many', { retryAfter: 3600 });
    if (!limiters.rotatesIp.take(ip)) { limiters.rotates.release(lib.key); throw httpError(429, 'Too many code changes from this network. Try again later.', 'too-many', { retryAfter: 3600 }); }
    try { await readJson(req, L.SMALL_BODY); } catch (e) { limiters.rotates.release(lib.key); limiters.rotatesIp.release(ip); throw e; }
    return rotateNow(res, lib, replaceRecovery);
  }
  async function rotate(req, res) {
    const lib = await requireLib(req);
    return rotateWithBody(req, res, lib, false);
  }
  /* A wrong recovery code is a failure like a wrong code, counted per address (20 an hour, then 429): it is a second way in, so it is limited the same way. */
  function badRecovery(req) {
    if (!limiters.badCodes.take(addressOf(req))) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });
    return httpError(401, 'That recovery code is not valid.', 'bad-recovery');
  }
  async function recover(req, res) {
    requireSameSite(req);
    const raw = req.headers[RECOVERY_HEADER];
    if (raw === undefined) throw httpError(401, 'No recovery code was sent.', 'no-recovery');
    if (typeof raw !== 'string' || !CODE_RE.test(raw)) throw badRecovery(req);
    await ensureLoaded();
    const got = recoveryHashOf(raw);
    const id = recoveryIndex.get(recoveryKeyOf(got));
    const rec = id ? libs.get(id) || null : null;
    const want = rec && rec.recoveryHash ? rec.recoveryHash : DUMMY_HASH;
    const same = want.length === got.length && crypto.timingSafeEqual(want, got);
    if (!same || !rec || rec.revokedAt || rec.writing) throw badRecovery(req);
    const t = now();
    rec.lastUsedAt = t;
    await persistUse(rec, t);
    return rotateWithBody(req, res, rec, true);
  }

  async function deleteLib(req, res) {
    const lib = await requireLib(req);
    noBody(req);
    return exclusive(async () => {
      const cur = libs.get(lib.id);
      if (!cur || cur.revokedAt || !cur.hash.equals(lib.hash)) throw goneError(lib.id);
      const t = now();
      let ok = false;
      const ep = epoch();
      try { ok = await store.deleteLib(cur.id, t); } catch (e) { staleAfterFailure(); throw e; }
      checkEpoch(ep);
      if (!ok) throw goneError(lib.id);
      Object.assign(cur, { revokedAt: t, bytes: 0, items: 0, tombs: 0, oldestTomb: 0 });
      if (cur.recoveryHash && recoveryIndex.get(recoveryKeyOf(cur.recoveryHash)) === cur.id) recoveryIndex.delete(recoveryKeyOf(cur.recoveryHash));
      reply(res, 200, { ok: true });
    });
  }

  /* ================= routing ================= */
  function owns(p) {
    return p === '/api/libs' || p === '/api/libs/me' || p === '/api/libs/me/rotate' || p === '/api/libs/recover' || p === '/api/sync/changes' || p === '/api/sync/items' || p.indexOf('/api/sync/items/') === 0;
  }
  async function route(req, res, url) {
    const m = req.method, p = url.pathname;
    let g;
    if (p === '/api/libs') {
      if (m === 'POST') return createLib(req, res);
    } else if (p === '/api/libs/me') {
      if (m === 'DELETE') return deleteLib(req, res);
    } else if (p === '/api/libs/me/rotate') {
      if (m === 'POST') return rotate(req, res);
    } else if (p === '/api/libs/recover') {
      if (m === 'POST') return recover(req, res);
    } else if (p === '/api/sync/changes') {
      if (m === 'GET') return changes(req, res, url);
    } else if (p === '/api/sync/items') {
      if (m === 'GET') return readItems(req, res, url);
      if (m === 'PUT') return putItems(req, res);
    } else if ((g = /^\/api\/sync\/items\/([^/]{1,100})$/.exec(p))) {
      if (m === 'DELETE') return deleteItem(req, res, url, g[1]);
    } else {
      return deps.jsonError(res, 404, 'Not found');
    }
    return deps.jsonError(res, 405, 'Method not allowed');
  }

  /* which counter of the hourly line an answer belongs to */
  const BUCKET = { 'bad-code': 'badCode', 'no-lib': 'badCode', 'bad-recovery': 'badCode', 'no-recovery': 'badCode', rotated: 'badCode', deleted: 'badCode', 'cross-site': 'crossSite', 'too-many': 'tooMany', 'in-flight': 'tooMany', quota: 'quota', busy: 'busy',
    budget: 'budget', share: 'share', slow: 'slow', 'bad-body': 'shape', 'too-large': 'tooLarge', 'item-too-large': 'tooLarge', 'batch-too-large': 'tooLarge', 'bad-item': 'badItem', 'bad-gzip': 'badItem',
    'bad-key': 'badItem', 'dup-key': 'badItem', 'bad-rev': 'badItem', 'bad-hash': 'badItem', 'bad-device': 'badItem', 'no-items': 'badItem', 'too-many-items': 'badItem', store: 'store' };
  /* resolves when the request has been answered; never rejects */
  async function handle(req, res, url) {
    win.requests++;
    if (disabledWhy) return deps.send(res, 503, { error: 'Syncing songs is not available right now. Try again in a minute.', code: 'store', disabled: true }, announcesBody(req) ? { 'Cache-Control': 'no-store', Connection: 'close' } : { 'Cache-Control': 'no-store' });
    try {
      await route(req, res, url);
    } catch (e) {
      if (e && e.http) {
        const h = e.http;
        const b = (h.code && BUCKET[h.code]) || 'other';
        win.refused[b]++;
        const headers = h.extra && h.extra.retryAfter ? { 'Retry-After': String(h.extra.retryAfter) } : {};
        /* a body that was refused without being read (or that stalled, or was cut) is not read on: the answer closes the connection. So does the refusal (a wrong code, a limit, a
           busy place) of a request that announced a body: otherwise the server would read the whole of it only to throw it away. */
        if ((h.extra && h.extra.close) || (announcesBody(req) && (h.status === 401 || h.status === 403 || h.status === 429 || h.status === 503))) headers.Connection = 'close';
        if (!res.headersSent) deps.send(res, h.status, Object.assign({ error: e.message }, h.code ? { code: h.code } : {}), Object.assign({ 'Cache-Control': 'no-store' }, headers));
        return;
      }
      win.refused.store++;
      logError(e);
      if (!res.headersSent) deps.send(res, 503, { error: 'Syncing songs is not available right now. Try again in a minute.', code: 'store' }, announcesBody(req) ? { 'Cache-Control': 'no-store', Connection: 'close' } : { 'Cache-Control': 'no-store' });
    }
  }

  /* the numbers of the hourly stats line (server-stats.js): counted since the last line, and where the library stands now; `warn` is set at 80 % of the site's cap */
  function gauge(reset) {
    const live = liveLibs();
    let bytes = 0, items = 0, tombs = 0;
    live.forEach(l => { bytes += l.bytes; items += l.items; tombs += l.tombs; });
    const pct = C.totalBytes ? Math.round(bytes / C.totalBytes * 1000) / 10 : 0;
    const out = { libs: live.length, maxLibs: C.maxLibs, items: items, tombs: tombs, bytes: bytes, capBytes: C.totalBytes, pct: pct, loaded: loaded,
      made: win.libsMade, written: win.itemsWritten, deleted: win.itemsDeleted, read: win.itemsRead, bytesIn: win.bytesIn, bytesOut: win.bytesOut, conflicts: win.conflicts,
      purgedLibs: win.purgedLibs, purgedTombs: win.purgedTombs, requests: win.requests, refused: Object.assign({}, win.refused) };
    if (bytes >= C.totalBytes * L.WARN_AT) out.warn = 'sync storage is at ' + pct + ' % of its ' + Math.round(C.totalBytes / MiB) + ' MB cap';
    if (live.length >= C.maxLibs * L.WARN_AT) out.warnLibs = 'sync libraries are at ' + live.length + ' of ' + C.maxLibs;
    if (reset !== false) win = freshWindow();
    return out;
  }

  return {
    owns: owns, handle: handle, config: C, gauge: gauge,
    /* switch the whole feature off for this run (every route answers 503 "store"), with the reason for the log; a restart tries again */
    disable: why => { disabledWhy = String(why || 'disabled'); },
    isDisabled: () => !!disabledWhy,
    /* for tests */
    _state: { libs: libs, rotatedTo: rotatedTo, limiters: limiters, stats: stats, config: C, budget: (kind, t) => ({ hour: budget[kind].hour.used(t), day: budget[kind].day.used(t) }),
      isLoaded: () => loaded, forgetAll: () => { loaded = false; }, purge: t => purgeIfDue(t, true), slots: slots, window: () => win, peakProcessing: () => processingPeak }
  };
}

module.exports = { create, LIMITS, SONG_FIELDS, SHAPES, KEY_RE, CODE_RE, LIB_HEADER, RECOVERY_HEADER, configFrom, newLibrary, codeHash, recoveryHashOf, libIdOf, tagOfId, validScore, itemShape };
