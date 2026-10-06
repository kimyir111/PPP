/* G10b-1 / G10b-2: the home-PC transcription queue (docs/GOALS/G10B_HOME_WORKER.md).

   A person asks the site to transcribe a YouTube link with the strong piano models (the helper ensemble, TransKun + Kong). The site cannot
   run them for free, so it only keeps the QUEUE: a worker script on that person's own PC polls the site with a token, claims the job, downloads
   the audio, runs transcribe.py on the PC's GPU and posts the notes back (tools/home-worker/). The page then writes the notation from those notes
   in the browser, as it does for the browser model's.

   What this module is, and is not:
     - the routes (server.js hands every /api/jobs..., /api/worker/... and /api/pc-links... request to handle()), the rules, the in-memory queue;
     - the DATABASE is only the durable copy (home-jobs-store.js): it is written on enqueue, claim, finish, fail, cancel,
       purge, link create/rotate/revoke, and read ONCE after a boot (the first request that needs the queue). A poll that finds
       nothing to do answers from memory and runs no SQL at all (Neon's compute hours; tests/home-worker/ counts the queries);
     - ONE instance. The queue lives in this process: a second instance would not see the first one's claims in memory. The SQL
       guards (a claim only moves a row that is still queued) keep the data right if that ever happens, but the long-poll and
       "is the PC alive" would not. Render's free plan runs one instance; scaling out means moving the queue into the database.

   NO ACCOUNT (G10b-2, the user's decision 2026-10-07: nothing on the site may force a login). A "PC link" is two random secrets made by ANY browser:
     - the CLIENT CODE (64 hex = 256 bits; the browser keeps it, in localStorage, and may type it on another device): it lets a device queue, list,
       cancel, remove and open the jobs of that link, read the worker status, rotate the worker token and revoke the link. It travels in the
       X-PPP-PC request header of this site's own page (a custom header: a page of another origin cannot send it, CORS is closed, and every browser
       route also refuses an Origin that is not this site). No cookie is read.
     - the WORKER TOKEN (ppw_<id>_<secret>, as before): kept by the PC; it lets the PC claim and complete the jobs of that link, nothing else.
   Only SHA-256 hashes are kept (like the guest-link key), compared in constant time. The link's id is derived from the code's hash ('pc_' + 22 hex)
   and is the owner of every job and token, so the queue's rules (the per-owner caps, quotas, eviction, the SQL guards that name the owner)
   are the ones of PR 178 with the identity changed. What stops a stranger: making a link is limited per address (5 an hour, 20 a day: counted from the
   links themselves, so it survives a restart) and for the whole site (500 live links); a link that is never used goes; and the quotas are per
   link, per creating address (a KEYED hash of it, never the address) and for the site. See docs/GOALS/G10B_HOME_WORKER.md section 12.

   The server tells the worker how long to wait (nextPollSeconds in every worker answer): 15 s while the link has a job
   queued or claimed or one finished in the last 5 minutes, otherwise an hour (PPP_WORKER_IDLE_POLL_S, never under 15 minutes). Every request wakes
   the free instance for 15 minutes, so a worker that polled every minute would keep it awake all month. */
'use strict';
const crypto = require('crypto');
const net = require('net');
const guestShare = require('./share-guest');
const R = require('./home-result');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIMITS = {
  /* the queue */
  PENDING_PER_USER: 5,
  ROWS_PER_USER: 30,
  MAX_ROWS: 5000,
  MAX_ATTEMPTS: 3,
  /* a claimed job nobody has been heard of for this long goes back to the queue (or fails after the last attempt) */
  LEASE_MS: 30 * 60 * 1000,
  /* a job nobody claimed in this long is not wanted any more */
  QUEUED_TTL_MS: 3 * DAY,
  /* a job the worker gave back to be tried again is not handed out again for this long (times the attempts so far): a download that
     failed has to be given a little time, not three tries in one minute */
  RETRY_DELAY_MS: 2 * 60 * 1000,
  /* how long a finished row is kept: its notes are 100-400 KB each, and Postgres storage is small */
  DONE_TTL_MS: 3 * DAY,
  OTHER_TTL_MS: 1 * DAY,
  PURGE_EVERY_MS: 6 * HOUR,
  /* what all stored notes together may take of the free database (Neon Free is small, and shared with the shared scores): past it, no job is
     accepted and no result is stored until the keeping time frees room. PC links are free to make, so the per-link caps alone are not a bound. */
  TOTAL_RESULT_BYTES: 64 * 1024 * 1024,
  /* ... and what one link may hold of it, so one person (or a few) cannot use it all up: 8 MB is about 70 typical conversions, and
     the 30 rows a link may keep are 3-4 MB when typical */
  PER_USER_RESULT_BYTES: 8 * 1024 * 1024,
  /* ... and what all the links made from ONE address (a keyed hash of it, kept on the link) may hold: links are free to make, and each one has its own
     worker token, so without this a single address could fill the site's whole share with results it wrote itself */
  PER_ADDRESS_RESULT_BYTES: 16 * 1024 * 1024,
  /* ... and how many rows (any state) all the links made from one address may hold together: with no PC at all a link can queue and cancel 30 rows, and the site holds
     MAX_ROWS in all, so a few addresses could otherwise fill it */
  ROWS_PER_ADDRESS: 100,
  /* a new job asks for this much room among its link's share (the oldest finished conversions are cleared to make it), so that the result
     the PC posts later is not refused: a typical result is 100-400 KB, the biggest the schema allows is 2 MB, a 20,000-note one 0.9 MB */
  RESULT_RESERVE_BYTES: 1024 * 1024,
  /* how long an idle worker is told to wait (nextPollSeconds). Every request wakes the free web service for 15 minutes, so an idle wait
     under about 15 minutes keeps it awake all month; the default is an hour, and nothing under 15 minutes is accepted */
  IDLE_POLL_DEFAULT_S: 3600,
  IDLE_POLL_FLOOR_S: 900,
  SWEEP_EVERY_MS: 10 * 1000,
  /* request bodies */
  JOB_BODY: 4 * 1024,
  SMALL_BODY: 4 * 1024,
  RESULT_BODY: R.LIMITS.RESULT_MAX_BYTES + 1024 * 1024,
  RESULT_DRAIN: 8 * 1024 * 1024,
  /* rates: per link, and per client address (the global bucket this replaces let one person use up everybody's hour) */
  ENQUEUE_PER_HOUR: 30,
  ENQUEUE_PER_IP_PER_HOUR: 60,
  /* a new worker token for a link (rotation), per link and per address */
  TOKENS_PER_HOUR: 10,
  TOKENS_PER_IP_PER_HOUR: 20,
  CLAIMS_PER_HOUR: 600,
  /* wrong secrets (a client code or a worker token that is not a live one) per address; only FAILURES are counted, a valid secret is never refused for it */
  BAD_TOKENS_PER_HOUR: 20,
  /* PC links: made by anybody, so bounded. Per creating address (an IPv6 address counts as its /64) and for the whole site; counted from the links themselves
     (not from a timer in memory), so a restart does not forget them */
  LINKS_PER_IP_PER_HOUR: 5,
  LINKS_PER_IP_PER_DAY: 20,
  MAX_LINKS: 500,
  /* a link nobody used (the page, or its PC) for this long is purged; one whose PC never connected and that holds no job, after the shorter time; a revoked
     one is kept this long (so that making and removing links does not get round the per-address limits) and then purged */
  LINK_UNUSED_TTL_MS: 60 * DAY,
  LINK_NEVER_CONNECTED_TTL_MS: 14 * DAY,
  LINK_REVOKED_KEEP_MS: 2 * DAY,
  /* when a link is used, the database is told at most this often (and only by a page request or a PC that is doing something: an idle poll writes nothing) */
  LINK_TOUCH_MS: 6 * HOUR
};

function configFrom(env, over) {
  const warnings = [];
  const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  let idle = LIMITS.IDLE_POLL_DEFAULT_S;
  const raw = env.PPP_WORKER_IDLE_POLL_S;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) warnings.push('PPP_WORKER_IDLE_POLL_S=' + JSON.stringify(String(raw).slice(0, 20)) + ' is not a number; using ' + idle + '.');
    else if (n < LIMITS.IDLE_POLL_FLOOR_S) {
      warnings.push('PPP_WORKER_IDLE_POLL_S=' + n + ' is below ' + LIMITS.IDLE_POLL_FLOOR_S + '; using ' + LIMITS.IDLE_POLL_FLOOR_S + '.');
      idle = LIMITS.IDLE_POLL_FLOOR_S;
    } else idle = Math.min(86400, n);
  }
  /* a poll keeps the free instance up about 15.8 minutes: with a shorter wait it never sleeps (Render: 750 free hours a month, shared) */
  if (idle < 1800) warnings.push('an idle worker wait of ' + idle + ' s keeps ppp-web awake about ' + Math.min(100, Math.round(15.8 * 60 / idle * 100)) + '% of the month; 3600 or more is advised.');
  const mb = int(env.PPP_WORKER_TOTAL_RESULT_MB, LIMITS.TOTAL_RESULT_BYTES / 1048576, 8, 512);
  return Object.assign({
    idlePollS: idle,
    activePollS: int(env.PPP_WORKER_ACTIVE_POLL_S, 15, 5, 300),
    /* after something finished, this long the worker is still asked to come back soon (the next job of a batch) */
    activeTailMs: 5 * 60 * 1000,
    /* a poll with work in sight waits this long for a job to arrive; with nothing in sight it returns at once */
    longPollMs: 25 * 1000,
    totalResultBytes: mb * 1048576,
    perUserResultBytes: LIMITS.PER_USER_RESULT_BYTES,
    perAddressResultBytes: LIMITS.PER_ADDRESS_RESULT_BYTES,
    resultReserveBytes: LIMITS.RESULT_RESERVE_BYTES,
    warnings: warnings
  }, over || {});
}

function httpError(status, message, code, extra) {
  const e = new Error(message);
  e.http = { status: status, code: code, extra: extra };
  return e;
}

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest();
const TOKEN_RE = /^ppw_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/;
const DUMMY_HASH = sha256('no such token');

function newToken() {
  const id = crypto.randomBytes(9).toString('base64url');
  const token = 'ppw_' + id + '_' + crypto.randomBytes(32).toString('base64url');
  return { id: id, token: token, hash: sha256(token).toString('hex') };
}
function parseToken(header) {
  const m = /^Bearer ([^\s]+)$/.exec(String(header || ''));
  if (!m) return null;
  const t = TOKEN_RE.exec(m[1]);
  return t ? { id: t[1], token: m[1] } : null;
}

/* ---- the client code of a PC link: 64 lowercase hex (256 random bits), sent as X-PPP-PC; nothing else is a code ---- */
const PC_HEADER = 'x-ppp-pc';
const CODE_RE = /^[0-9a-f]{64}$/;
const LINK_PREFIX = 'pc_';
/* the hash is domain-separated: a guest-link key (also 64 hex in the page) or any other secret can never be the same bytes */
const codeHash = code => sha256('ppp-pc-link-v1:' + code);
const linkIdOf = hash => LINK_PREFIX + hash.toString('hex').slice(0, 22);
function newLink() {
  const code = crypto.randomBytes(32).toString('hex');
  const hash = codeHash(code);
  return { code: code, hash: hash, id: linkIdOf(hash) };
}
/* an address as the per-address limits see it: an IPv6 address is its /56 (what a home connection is given is a /56 or a /64, and one network has billions of addresses
   in it), an IPv4-mapped one is the IPv4 */
function addrKey(ip) {
  const s = String(ip || 'unknown').toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) return m[1];
  const bare = s.split('%')[0];
  if (bare.indexOf(':') < 0 || bare.indexOf('.') >= 0 || !net.isIPv6(bare)) return s;
  const halves = bare.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail);
  const g = groups.map(x => x.padStart(4, '0'));
  return g[0] + ':' + g[1] + ':' + g[2] + ':' + g[3].slice(0, 2) + '00::/56';
}

const iso = t => (t ? new Date(t).toISOString() : null);

function create(deps) {
  const store = deps.store;
  const now = deps.now || Date.now;
  const C = configFrom(deps.env || process.env, deps.config);
  const parseYoutube = deps.parseYoutube;
  const logError = deps.logError || (() => {});
  const L = LIMITS;

  /* ----- the queue, in memory ----- */
  const jobs = new Map();          /* id -> job (every row, without its notes) */
  const tokens = new Map();        /* id -> live token (hash as a Buffer); ownerId is the id of its PC link */
  const links = new Map();         /* id ('pc_...') -> PC link (hash of the client code as a Buffer), revoked ones too until they are purged */
  const waiters = new Map();       /* ownerId -> Set<function> : long-polls waiting for a job */
  const lastFinished = new Map();  /* ownerId -> ms of the last done/failed */
  /* the key the creating address is hashed with (it is never stored): a secret of the server, so a stolen table cannot be turned back into addresses */
  const ipKey = crypto.createHmac('sha256', String(deps.ipSecret || crypto.randomBytes(32).toString('hex'))).update('ppp-pc-link-address').digest();
  const tagOf = ip => crypto.createHmac('sha256', ipKey).update(addrKey(ip)).digest('hex').slice(0, 16);
  let loaded = false, loading = null, lastSweep = 0, lastPurge = 0;
  /* null, or why the queue is off: the server could not make its tables at the boot (home-jobs-store.js migrate). The site goes on without it. */
  let disabledWhy = null;
  const stats = { loads: 0 };
  C.warnings.forEach(w => { if (deps.warn) deps.warn(w); });

  const limiters = {
    enqueue: guestShare.slidingWindow(L.ENQUEUE_PER_HOUR, HOUR),
    enqueueIp: guestShare.slidingWindow(L.ENQUEUE_PER_IP_PER_HOUR, HOUR),
    tokens: guestShare.slidingWindow(L.TOKENS_PER_HOUR, HOUR),
    tokensIp: guestShare.slidingWindow(L.TOKENS_PER_IP_PER_HOUR, HOUR),
    claims: guestShare.slidingWindow(L.CLAIMS_PER_HOUR, HOUR),
    badTokens: guestShare.slidingWindow(L.BAD_TOKENS_PER_HOUR, HOUR)
  };

  function fill(data) {
    /* a link that is being made right now (its row is not in the database yet) is not in what was read: it must not be lost to a re-read (a claim that found the memory behind) */
    const making = Array.from(links.values()).filter(l => l.writing);
    const makingTokens = Array.from(tokens.values()).filter(k => making.some(l => l.id === k.ownerId));
    jobs.clear(); tokens.clear(); links.clear(); lastFinished.clear();
    (data.links || []).forEach(l => {
      if (!l || typeof l.id !== 'string' || l.id.slice(0, 3) !== LINK_PREFIX) return;
      const hash = Buffer.from(String(l.hash), 'hex');
      if (hash.length !== 32) return;
      links.set(l.id, { id: l.id, hash: hash, createdAt: l.createdAt || 0, lastUsedAt: l.lastUsedAt || l.createdAt || 0, lastWorkerAt: l.lastWorkerAt || 0,
        ipTag: l.ipTag || '', revokedAt: l.revokedAt || 0, persistedAt: l.lastUsedAt || l.createdAt || 0, writing: false });
    });
    /* only the rows of a live PC link are the queue's: whatever else is in the tables (an account's rows from PR 178, the rows of a link that was revoked) is not loaded, so it is
       never served; the keeping time deletes the finished ones */
    const live = id => { const l = links.get(id); return !!l && !l.revokedAt; };
    data.jobs.forEach(j => {
      if (!live(j.ownerId)) return;
      jobs.set(j.id, Object.assign({ beatAt: 0, progress: null }, j));
      if ((j.status === 'done' || j.status === 'failed') && j.finishedAt > (lastFinished.get(j.ownerId) || 0)) lastFinished.set(j.ownerId, j.finishedAt);
    });
    data.tokens.forEach(k => {
      if (k.revokedAt || !live(k.ownerId)) return;
      /* one live token per link: if the database holds more (a rotation that was cut off), the newest is the one */
      const other = Array.from(tokens.values()).find(x => x.ownerId === k.ownerId);
      if (other && other.createdAt >= k.createdAt) return;
      if (other) tokens.delete(other.id);
      tokens.set(k.id, { id: k.id, ownerId: k.ownerId, hash: Buffer.from(String(k.hash), 'hex'), label: k.label, createdAt: k.createdAt,
        lastSeenAt: k.lastSeenAt || 0, pollS: k.pollS || 0 });
    });
    tokens.forEach(k => { const l = links.get(k.ownerId); if (l && k.lastSeenAt > l.lastWorkerAt) l.lastWorkerAt = k.lastSeenAt; });
    making.forEach(l => { if (!links.has(l.id)) links.set(l.id, l); });
    makingTokens.forEach(k => { if (!tokens.has(k.id)) tokens.set(k.id, k); });
  }

  /* The one read of a boot. Shared by every request that arrives meanwhile; a failure is not remembered (the next
     request tries again), and the caller answers 503. Returns true when THIS call did the load (a "cold" request). */
  async function ensureLoaded() {
    if (loaded) return false;
    if (!loading) {
      loading = store.loadAll().then(async data => {
        fill(data); loaded = true; stats.loads++;
        /* the database is awake for this read anyway: finished rows past their keeping time go now (a DELETE only if there are any) */
        await purgeIfDue(now(), true);
      }).finally(() => { loading = null; });
      await loading;
      return true;
    }
    await loading;
    return false;
  }

  /* ----- who is asking ----- */
  /* a browser request that changes something, or reads a link's own data, must come from this site: a page of another origin cannot send the custom
     header at all (CORS is closed, so its preflight fails), and an Origin that is not this site is refused here as well, whatever the method */
  function sameSite(req) {
    const origin = req.headers.origin;
    if (origin == null) return true;
    try { return !!req.headers.host && new URL(String(origin)).host === req.headers.host; } catch (e) { return false; }
  }
  function requireSameSite(req) {
    if (!sameSite(req)) throw httpError(403, 'That request did not come from this site.', 'cross-site');
  }
  /* A failure (a secret that is not shaped like one, or that is not a live one) is counted against the client address, and past 20 an hour
     the answer to a failure is 429. A request with a VALID secret is never refused for that: other people's wrong secrets from the same address
     (a shared PC, a network) must not lock a working page or worker out. */
  function badSecret(req, what) {
    const ip = deps.clientIp(req) || 'unknown';
    if (!limiters.badTokens.take(ip)) return httpError(429, what === 'code' ? 'Too many wrong codes from here. Try again later.' : 'Too many wrong tokens from here. Try again later.', 'too-many', { retryAfter: 600 });
    return what === 'code' ? httpError(401, 'That PC link is not valid.', 'bad-code') : httpError(401, 'That token is not valid.', 'bad-token');
  }
  const badToken = req => badSecret(req, 'token');
  /* a secret is compared as hashes, in constant time; one that does not exist is compared against a dummy so the time does not tell. The id picks the record
     (the first bytes of the hash: not the secret), the full hash is what is compared. */
  function verifyToken(t) {
    const rec = tokens.get(t.id) || null;
    const want = rec ? rec.hash : DUMMY_HASH;
    const got = sha256(t.token);
    const same = want.length === got.length && crypto.timingSafeEqual(want, got);
    return same && rec ? rec : null;
  }
  /* is this token still the live one of a live link? (asked again after anything that waited: a long-poll, a body, a clearing of room - the token may have been replaced or the link removed meanwhile) */
  const alive = rec => { const l = links.get(rec.ownerId); return tokens.get(rec.id) === rec && !!l && !l.revokedAt; };
  function verifyCode(code) {
    const got = codeHash(code);
    const rec = links.get(linkIdOf(got)) || null;
    const want = rec ? rec.hash : DUMMY_HASH;
    const same = want.length === got.length && crypto.timingSafeEqual(want, got);
    return same && rec && !rec.revokedAt && !rec.writing ? rec : null;
  }
  /* the PC link a browser request names with X-PPP-PC, or an error: no header = 401 "no-link" (nothing was guessed, so nothing is counted); a header that is not a
     64-hex code, or not a live link's code = a failure (counted, 401 "bad-code", 429 past the budget). The page is only ever told "not valid". */
  async function requireLink(req) {
    requireSameSite(req);
    const raw = req.headers[PC_HEADER];
    if (raw === undefined) throw httpError(401, 'No PC link on this device.', 'no-link');
    if (typeof raw !== 'string' || !CODE_RE.test(raw)) throw badSecret(req, 'code');
    await ensureLoaded();
    const link = verifyCode(raw);
    if (!link) throw badSecret(req, 'code');
    const t = now();
    link.lastUsedAt = t;
    await persistLink(link, t);
    return link;
  }

  /* ----- views ----- */
  function publicJob(j) {
    const o = {
      id: j.id, kind: j.kind, url: j.url, title: j.title, status: j.status, attempts: j.attempts,
      createdAt: iso(j.createdAt), claimedAt: iso(j.claimedAt), finishedAt: iso(j.finishedAt), error: j.error || ''
    };
    if (j.status === 'done') o.bytes = j.bytes;
    if (j.status === 'claimed' && j.progress) o.progress = j.progress;
    return o;
  }
  /* the notes kept for all the links made from one address (by the keyed hash on the link) */
  const addressRows = tag => { let n = 0; jobs.forEach(j => { const l = links.get(j.ownerId); if (l && l.ipTag === tag) n++; }); return n; };
  const addressBytes = tag => { let n = 0; jobs.forEach(j => { if (j.status === 'done') { const l = links.get(j.ownerId); if (l && l.ipTag === tag) n += j.bytes || 0; } }); return n; };
  const storedBytes = ownerId => { let n = 0; jobs.forEach(j => { if (j.status === 'done' && (ownerId == null || j.ownerId === ownerId)) n += j.bytes || 0; }); return n; };
  /* Room for one link's new row and notes among ITS OWN finished rows: the oldest go first (failed, cancelled and expired ones before done ones),
     until the notes kept plus needBytes fit the link's share and the rows plus needRows fit its row cap. The link's share is never a reason to
     refuse a person's work or to lock them out until the keeping time is over; nobody else's rows are touched, and a waiting or converting one never goes
     (only finished rows are candidates). `except` is the job that is asking (already in the queue as a reserved slot: it is the row that needRows stands for).
     Returns the rows removed. */
  async function evict(ownerId, needBytes, needRows, except) {
    const mine = ownJobs(ownerId).filter(j => j !== except);
    const byAge = (a, b) => (a.finishedAt || a.createdAt) - (b.finishedAt || b.createdAt);
    const old = mine.filter(j => !pending(j) && !j.writing);
    let stored = storedBytes(ownerId), rows = mine.length;
    const gone = [];
    /* the notes: only a finished conversion that holds some can free any, the oldest first */
    old.filter(j => j.status === 'done').sort(byAge).forEach(j => {
      if (stored + needBytes <= C.perUserResultBytes) return;
      gone.push(j); stored -= j.bytes || 0; rows--;
    });
    /* the rows: failed, cancelled and expired ones before done ones, the oldest first */
    old.filter(j => gone.indexOf(j) < 0).sort((a, b) => ((a.status === 'done') - (b.status === 'done')) || byAge(a, b)).forEach(j => {
      if (!needRows || rows + needRows <= L.ROWS_PER_USER) return;
      gone.push(j); if (j.status === 'done') stored -= j.bytes || 0; rows--;
    });
    if (gone.length) { await store.deleteJobs(gone.map(j => j.id), ownerId); gone.forEach(j => jobs.delete(j.id)); }
    return gone;
  }
  const ownJobs = ownerId => { const out = []; jobs.forEach(j => { if (j.ownerId === ownerId) out.push(j); }); return out; };
  const pending = j => j.status === 'queued' || j.status === 'claimed';

  function isActive(ownerId, t) {
    for (const j of jobs.values()) if (j.ownerId === ownerId && pending(j)) return true;
    const f = lastFinished.get(ownerId) || 0;
    return f > 0 && t - f <= C.activeTailMs;
  }
  function nextPollS(ownerId, t) { return isActive(ownerId, t) ? C.activePollS : C.idlePollS; }

  function workerSummary(ownerId, t) {
    let has = false, seen = 0, pollS = 0;
    tokens.forEach(k => {
      if (k.ownerId !== ownerId) return;
      has = true;
      if (k.lastSeenAt > seen) { seen = k.lastSeenAt; pollS = k.pollS; }
    });
    /* alive: heard of within twice the wait it announced (a --once worker announces none: a couple of minutes) */
    const alive = seen > 0 && t - seen <= Math.max(2 * pollS, 120) * 1000 + 30000;
    return { hasToken: has, everSeen: seen > 0, alive: alive, lastSeenAt: iso(seen), idlePollSeconds: C.idlePollS, activePollSeconds: C.activePollS };
  }

  /* ----- changes that need the store: memory first (one turn of the event loop), then the database; a failed write is undone ----- */
  async function persist(undo, work) {
    try { return await work(); } catch (e) { try { undo(); } catch (e2) { /* nothing more to do */ } throw e; }
  }
  function wake(ownerId) {
    const set = waiters.get(ownerId);
    if (set) Array.from(set).forEach(fn => fn());
  }
  function touch(rec, t, pollS) {
    rec.lastSeenAt = t;
    rec.pollS = pollS;
    const link = links.get(rec.ownerId);
    if (link) link.lastWorkerAt = t;
  }
  /* write the link's last-use times to the database, at most every LINK_TOUCH_MS per link (the keeping time of a link is days, so hours are exact enough). Called where
     the database is being used anyway (a page request, a claim, a result, the cold first poll after a boot) - never by an idle poll. A failure is only logged. */
  async function persistLink(link, t) {
    if (!link || link.revokedAt || t - link.persistedAt < L.LINK_TOUCH_MS) return;
    const was = link.persistedAt;
    link.persistedAt = t;
    /* a write that fails is tried again in a minute (not by every request while the database is down) */
    try { await store.touchLink(link.id, link.lastUsedAt, link.lastWorkerAt); } catch (e) { link.persistedAt = Math.max(was, t - L.LINK_TOUCH_MS + 60 * 1000); logError(e); }
  }
  /* write the token's last-seen time to the database: only where the database is being used anyway */
  async function persistSeen(rec) {
    try { await store.touchSeen(rec.id, rec.ownerId, rec.lastSeenAt, rec.pollS); } catch (e) { logError(e); }
    await persistLink(links.get(rec.ownerId), rec.lastSeenAt);
  }

  /* Claimed jobs nobody has heard of for the lease go back to the queue (or fail on the last attempt); queued jobs nobody
     wanted for three days expire. Cheap, in memory, at most every 10 s; the database is written only when something changes. */
  async function sweep(t) {
    if (t - lastSweep < L.SWEEP_EVERY_MS) return;
    lastSweep = t;
    for (const j of Array.from(jobs.values())) {
      if (j.status === 'claimed' && t - Math.max(j.claimedAt, j.beatAt) > L.LEASE_MS) {
        try {
          if (j.attempts >= L.MAX_ATTEMPTS) {
            if (await store.finishJob(j.id, j.ownerId, 'failed', t, { error: 'The PC did not finish this in time.' })) {
              Object.assign(j, { status: 'failed', finishedAt: t, error: 'The PC did not finish this in time.', progress: null });
              lastFinished.set(j.ownerId, t);
            }
          } else if (await store.requeueJob(j.id, j.ownerId, 'The PC did not finish; trying again.')) {
            Object.assign(j, { status: 'queued', workerId: null, claimedAt: 0, error: 'The PC did not finish; trying again.', progress: null });
            wake(j.ownerId);
          }
        } catch (e) { logError(e); }
      } else if (j.status === 'queued' && t - j.createdAt > L.QUEUED_TTL_MS) {
        try {
          if (await store.finishJob(j.id, j.ownerId, 'expired', t, { error: 'No PC picked this up in time.' }))
            Object.assign(j, { status: 'expired', finishedAt: t, error: 'No PC picked this up in time.' });
        } catch (e) { logError(e); }
      }
    }
  }

  /* A link that ran out. Not used by anybody (the page, its PC) for LINK_UNUSED_TTL_MS; or one whose PC never connected and that holds no job, after the shorter
     LINK_NEVER_CONNECTED_TTL_MS (the ones made and abandoned); or revoked longer ago than LINK_REVOKED_KEEP_MS. `seen` is each link's newest token last-seen time. */
  function linkExpired(l, t, seen) {
    if (l.writing) return false;
    if (l.revokedAt) return t - l.revokedAt > L.LINK_REVOKED_KEEP_MS;
    const heard = Math.max(l.lastWorkerAt || 0, seen.get(l.id) || 0);
    if (t - Math.max(l.createdAt, l.lastUsedAt, heard) > L.LINK_UNUSED_TTL_MS) return true;
    if (!heard && t - l.createdAt > L.LINK_NEVER_CONNECTED_TTL_MS) { for (const j of jobs.values()) if (j.ownerId === l.id) return false; return true; }
    return false;
  }

  /* Finished rows past their keeping time, and links that ran out (with their tokens and jobs), leave memory and the database. A DELETE runs only when memory says there is something to delete. */
  async function purgeIfDue(t, force) {
    if (!force && t - lastPurge < L.PURGE_EVERY_MS) return;
    lastPurge = t;
    const seen = new Map();
    tokens.forEach(k => { if (k.lastSeenAt > (seen.get(k.ownerId) || 0)) seen.set(k.ownerId, k.lastSeenAt); });
    const dead = [];
    links.forEach(l => { if (linkExpired(l, t, seen)) dead.push(l.id); });
    if (dead.length) {
      try {
        await store.deleteLinks(dead);
        const gone = new Set(dead);
        dead.forEach(id => { links.delete(id); lastFinished.delete(id); wake(id); });
        tokens.forEach((k, id) => { if (gone.has(k.ownerId)) tokens.delete(id); });
        jobs.forEach((j, id) => { if (gone.has(j.ownerId)) jobs.delete(id); });
      } catch (e) { logError(e); }
    }
    const doneBefore = t - L.DONE_TTL_MS, otherBefore = t - L.OTHER_TTL_MS;
    const gone = [];
    jobs.forEach(j => {
      if ((j.status === 'done' && j.finishedAt < doneBefore) || ((j.status === 'failed' || j.status === 'cancelled' || j.status === 'expired') && j.finishedAt < otherBefore)) gone.push(j.id);
    });
    if (!gone.length) return;
    try { await store.purge(doneBefore, otherBefore); gone.forEach(id => jobs.delete(id)); } catch (e) { logError(e); }
  }

  /* ----- body ----- */
  async function readJson(req, limit, drain) {
    let raw;
    /* an oversized body is read this far and thrown away, so the answer is a 413 on an open connection (and not a reset); beyond it the connection is cut */
    try { raw = await deps.readBody(req, limit, drain || 1024 * 1024); } catch (e) { throw httpError(413, 'That is larger than this accepts.', 'too-large'); }
    if (!raw.length) return {};
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { throw httpError(400, 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(422, 'Expected a JSON object.', 'bad-body');
    if (guestShare.inspect(body)) throw httpError(422, 'That cannot be stored.', 'bad-body');
    return body;
  }
  const reply = (res, status, body, headers) => deps.send(res, status, body, Object.assign({ 'Cache-Control': 'no-store' }, headers));

  /* ================= browser routes (the PC link's client code, X-PPP-PC) ================= */

  async function listJobs(req, res) {
    const link = await requireLink(req);
    const t = now();
    await sweep(t);
    const list = ownJobs(link.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, L.ROWS_PER_USER).map(publicJob);
    reply(res, 200, { jobs: list, worker: workerSummary(link.id, t) });
  }

  async function enqueue(req, res) {
    const link = await requireLink(req);
    const ip = addrKey(deps.clientIp(req) || 'unknown');
    /* the two hourly budgets are taken now and given back when the request turns out to make nothing (a body that is refused, a link that is not
       YouTube, a duplicate, a full queue): a refused request is free, and so cannot be used to use up someone else's budget */
    if (!limiters.enqueue.take(link.id)) throw httpError(429, 'Too many conversions were asked for just now. Try again in a little while.', 'too-many', { retryAfter: 600 });
    if (!limiters.enqueueIp.take(ip)) { limiters.enqueue.release(link.id); throw httpError(429, 'Too many conversions were asked for just now. Try again in a little while.', 'too-many', { retryAfter: 600 }); }
    const release = () => { limiters.enqueue.release(link.id); limiters.enqueueIp.release(ip); };
    let body, parsed;
    try {
      body = await readJson(req, L.JOB_BODY);
      parsed = parseYoutube(body.url);
      if (!parsed) throw httpError(422, 'That is not a link to a YouTube video.', 'bad-url');
      await ensureLoaded();
    } catch (e) { release(); throw e; }
    const t = now();
    await sweep(t);
    await purgeIfDue(t);
    /* the link itself may have run out in that purge (made more than 14 days ago, its PC never connected, nothing queued): it is not valid any more, and nothing is written for it */
    if (links.get(link.id) !== link || link.revokedAt) { release(); throw httpError(401, 'That PC link is not valid.', 'bad-code'); }
    /* From here to jobs.set below nothing is awaited: the checks and the taking of the slot are one turn of the event loop, so two requests at once cannot
       both pass the cap of waiting jobs or both add the same link, whatever the store is doing meanwhile (clearing room is a database call). */
    const mine = ownJobs(link.id);
    const dup = mine.find(j => pending(j) && j.url === parsed.url);
    if (dup) {
      /* the same link asked at the same moment: it is the one job the first request is writing - say so once that is durable, or fail as the first one does */
      if (dup.writing && dup.settled && !(await dup.settled)) { release(); throw httpError(503, 'The queue is not available right now. Try again in a minute.', 'store'); }
      release();
      return reply(res, 200, { job: publicJob(dup), existing: true, worker: workerSummary(link.id, t) });
    }
    if (mine.filter(pending).length >= L.PENDING_PER_USER) {
      release();
      throw httpError(429, 'You already have ' + L.PENDING_PER_USER + ' conversions waiting. Wait for one to finish, or cancel one.', 'queue-full');
    }
    if (storedBytes() >= C.totalResultBytes) { release(); throw httpError(503, 'The queue is full right now. Try again later.', 'busy'); }
    if (jobs.size >= L.MAX_ROWS) { release(); throw httpError(503, 'The queue is full right now. Try again later.', 'busy'); }
    const job = { id: crypto.randomBytes(12).toString('base64url'), ownerId: link.id, kind: 'youtube', url: parsed.url,
      title: R.cleanText(body.title, 120), status: 'queued', attempts: 0, workerId: null, createdAt: t, claimedAt: 0, finishedAt: 0, error: '', bytes: 0, beatAt: 0, progress: null };
    /* the slot is taken now, before anything is awaited: it counts as waiting (the cap, the duplicate check) and as a row, and nothing claims, cancels or clears it
       until it is durable. A failure gives it back. */
    job.writing = true;
    job.settled = new Promise(resolve => { job.settle = resolve; });
    jobs.set(job.id, job);
    const giveUp = e => { jobs.delete(job.id); job.settle(false); release(); throw e; };
    /* room for it among the person's own rows and notes: the oldest finished conversions are cleared first, and room is kept for its result */
    try { await evict(link.id, C.resultReserveBytes, 1, job); } catch (e) { giveUp(e); }
    /* the rows of all the links made from one address (this one's reserved row included) are bounded too */
    if (link.ipTag && addressRows(link.ipTag) > L.ROWS_PER_ADDRESS) giveUp(httpError(503, 'The queue is full right now. Try again later.', 'busy'));
    try { await store.insertJob(job); } catch (e) { giveUp(e); }
    /* the link was removed while the row was being written: the row is not anybody's now - sweep it (removing a link deletes what it owns) and say the link is gone */
    if (link.revokedAt) { try { await store.revokeLink(link.id, link.revokedAt); } catch (e) { logError(e); } giveUp(httpError(401, 'That PC link is not valid.', 'bad-code')); }
    job.writing = false;
    job.settle(true);
    wake(link.id);
    reply(res, 201, { job: publicJob(job), worker: workerSummary(link.id, t) });
  }

  async function ownJob(req, id) {
    const link = await requireLink(req);
    const job = jobs.get(id);
    /* somebody else's job is not there at all */
    if (!job || job.ownerId !== link.id) throw httpError(404, 'That conversion is not there.', 'not-found');
    return { link: link, job: job };
  }

  async function getJob(req, res, id) {
    const { link, job } = await ownJob(req, id);
    await sweep(now());
    const out = { job: publicJob(job) };
    if (job.status === 'done') {
      const result = await store.getResult(job.id, link.id);
      if (!result) throw httpError(410, 'The notes of that conversion are no longer kept.', 'gone');
      out.result = result;
    }
    reply(res, 200, out);
  }

  /* A finished conversion (done, failed, cancelled, expired) can be removed by its owner: its notes go from the database and from the link's share. A waiting
     or converting one is cancelled first. */
  async function deleteJob(req, res, id) {
    const { link, job } = await ownJob(req, id);
    if (pending(job) || job.writing) throw httpError(409, 'Cancel that conversion first, then remove it.', 'pending');
    await store.deleteJobs([job.id], link.id);
    jobs.delete(job.id);
    reply(res, 200, { ok: true });
  }

  async function cancelJob(req, res, id) {
    const { link, job } = await ownJob(req, id);
    if (job.status === 'cancelled') return reply(res, 200, { job: publicJob(job) });
    if (!pending(job)) throw httpError(409, 'That conversion has already finished.', 'finished');
    const t = now();
    const was = { status: job.status, finishedAt: job.finishedAt };
    job.status = 'cancelled'; job.finishedAt = t; job.progress = null;
    await persist(() => Object.assign(job, was), async () => {
      /* false: the row was not queued or claimed any more (finished at the same moment); the memory is put right below */
      if (!(await store.cancelJob(job.id, link.id, t))) { Object.assign(job, was); throw httpError(409, 'That conversion has already finished.', 'finished'); }
    });
    reply(res, 200, { job: publicJob(job) });
  }

  async function workerStatus(req, res) {
    const link = await requireLink(req);
    reply(res, 200, { worker: workerSummary(link.id, now()) });
  }

  /* ----- the PC link itself ----- */

  /* an address that cannot make another link right now: the seconds until the oldest link in the window ages out of it, or 0 when it can */
  function linkWait(tag, t) {
    let oldestHour = 0, oldestDay = 0, hour = 0, day = 0;
    links.forEach(l => {
      if (l.ipTag !== tag) return;
      if (t - l.createdAt < HOUR) { hour++; if (!oldestHour || l.createdAt < oldestHour) oldestHour = l.createdAt; }
      if (t - l.createdAt < DAY) { day++; if (!oldestDay || l.createdAt < oldestDay) oldestDay = l.createdAt; }
    });
    if (hour < L.LINKS_PER_IP_PER_HOUR && day < L.LINKS_PER_IP_PER_DAY) return 0;
    const wait = Math.max(hour >= L.LINKS_PER_IP_PER_HOUR ? oldestHour + HOUR - t : 0, day >= L.LINKS_PER_IP_PER_DAY ? oldestDay + DAY - t : 0);
    return Math.max(60, Math.min(86400, Math.ceil(wait / 1000)));
  }

  /* POST /api/pc-links - NO sign-in. Makes a link and its first worker token, and shows both secrets ONCE (the answer is the only place either is ever
     seen; the site keeps only their hashes). What an unknown visitor can do here is bounded: 5 links an hour and 20 a day from one address (counted from the links, so a
     restart does not forget them; a request that makes nothing costs nothing), and 500 live links in all. The slot is taken in memory before anything is awaited, so
     requests at the same moment cannot pass the limits together. */
  async function createLink(req, res) {
    requireSameSite(req);
    await readJson(req, L.SMALL_BODY);
    await ensureLoaded();
    const t = now();
    await purgeIfDue(t);
    const tag = tagOf(deps.clientIp(req) || 'unknown');
    const wait = linkWait(tag, t);
    if (wait) throw httpError(429, 'Too many PC links were made from here just now. Try again later.', 'too-many', { retryAfter: wait });
    let live = 0;
    links.forEach(l => { if (!l.revokedAt) live++; });
    if (live >= L.MAX_LINKS) throw httpError(503, 'PC links are full right now. Try again later.', 'busy');
    const made = newLink(), k = newToken();
    const link = { id: made.id, hash: made.hash, createdAt: t, lastUsedAt: t, lastWorkerAt: 0, ipTag: tag, revokedAt: 0, persistedAt: t, writing: true };
    const rec = { id: k.id, ownerId: link.id, hash: Buffer.from(k.hash, 'hex'), label: 'My PC', createdAt: t, lastSeenAt: 0, pollS: 0 };
    if (links.has(link.id) || tokens.has(rec.id)) throw httpError(503, 'The queue is not available right now. Try again in a minute.', 'store');
    links.set(link.id, link); tokens.set(rec.id, rec);
    try { await store.createLink({ id: link.id, hash: made.hash.toString('hex'), createdAt: t, ipTag: tag }, { id: rec.id, hash: k.hash, label: rec.label }); }
    catch (e) { links.delete(link.id); tokens.delete(rec.id); throw e; }
    link.writing = false;
    /* the only time either secret is ever shown */
    reply(res, 201, { id: link.id, clientCode: made.code, workerToken: k.token, workerTokenId: rec.id, createdAt: iso(t) });
  }

  /* DELETE /api/pc-links/me - with the client code. The link, its worker token and its conversions (with their notes) are removed at once; the PC is refused from now on. */
  async function revokeLink(req, res) {
    const link = await requireLink(req);
    const t = now();
    const ownTokens = Array.from(tokens.values()).filter(k => k.ownerId === link.id);
    const ownJobsList = ownJobs(link.id);
    const lf = lastFinished.get(link.id);
    link.revokedAt = t;
    ownTokens.forEach(k => tokens.delete(k.id));
    ownJobsList.forEach(j => jobs.delete(j.id));
    lastFinished.delete(link.id);
    try { await store.revokeLink(link.id, t); }
    catch (e) {
      link.revokedAt = 0;
      ownTokens.forEach(k => tokens.set(k.id, k));
      ownJobsList.forEach(j => jobs.set(j.id, j));
      if (lf) lastFinished.set(link.id, lf);
      throw e;
    }
    wake(link.id);
    reply(res, 200, { ok: true });
  }

  /* POST /api/pc-links/me/worker-token - with the client code. The link has ONE live worker token: this one replaces it (the old one is dead from this answer on) and is shown
     ONCE. It is how a lost token, or a token that leaked, is dealt with; limited per link and per address. */
  async function rotateToken(req, res) {
    const link = await requireLink(req);
    const ip = addrKey(deps.clientIp(req) || 'unknown');
    if (!limiters.tokens.take(link.id)) throw httpError(429, 'Too many tokens were made just now. Try again later.', 'too-many', { retryAfter: 600 });
    if (!limiters.tokensIp.take(ip)) { limiters.tokens.release(link.id); throw httpError(429, 'Too many tokens were made just now. Try again later.', 'too-many', { retryAfter: 600 }); }
    const release = () => { limiters.tokens.release(link.id); limiters.tokensIp.release(ip); };
    try { await readJson(req, L.SMALL_BODY); } catch (e) { release(); throw e; }
    const t = now();
    const old = Array.from(tokens.values()).filter(k => k.ownerId === link.id);
    const k = newToken();
    const inherit = old.reduce((a, x) => (x.lastSeenAt > a.lastSeenAt ? x : a), { lastSeenAt: 0, pollS: 0 });
    const rec = { id: k.id, ownerId: link.id, hash: Buffer.from(k.hash, 'hex'), label: 'My PC', createdAt: t, lastSeenAt: inherit.lastSeenAt, pollS: inherit.pollS };
    old.forEach(x => tokens.delete(x.id));
    tokens.set(rec.id, rec);
    /* put the old tokens back only if nothing replaced this one meanwhile (a second rotation at the same moment): a token that was replaced must not come back to life */
    const undoRotation = () => { if (tokens.get(rec.id) === rec) { tokens.delete(rec.id); old.forEach(x => tokens.set(x.id, x)); } };
    let ok = false;
    try { ok = await store.rotateToken(link.id, { id: rec.id, hash: k.hash, label: rec.label, lastSeenAt: rec.lastSeenAt, pollS: rec.pollS }, t); }
    catch (e) { undoRotation(); release(); throw e; }
    if (!ok) { undoRotation(); release(); throw httpError(401, 'That PC link is not valid.', 'bad-code'); }
    /* a PC that is waiting with the old token is let go now (it is asked again, and refused) */
    wake(link.id);
    reply(res, 201, { workerToken: k.token, workerTokenId: rec.id, createdAt: iso(t) });
  }

  /* ================= worker routes (a bearer token) ================= */

  async function workerOf(req) {
    const t = parseToken(req.headers.authorization);
    if (!t) throw badToken(req);          /* not shaped like a token: no need to read the queue to say so */
    const cold = await ensureLoaded();
    const rec = verifyToken(t);
    if (!rec) throw badToken(req);
    /* a token belongs to a PC link, and is only as alive as its link (a revoked or purged link has no tokens in memory; this is the second guard) */
    const link = links.get(rec.ownerId);
    if (!link || link.revokedAt || link.writing) throw badToken(req);
    return { rec: rec, link: link, cold: cold };
  }

  async function ping(req, res) {
    const { rec } = await workerOf(req);
    const t = now();
    /* a check (worker.js --check) is not a heartbeat: the first one only marks the PC as having connected (so the page can offer the button), and
       counts as "alive" for a couple of minutes (it announces no wait); after that it changes nothing, so a check can never make a PC that is
       off look connected for hours, nor shorten what a running worker announced */
    if (rec.lastSeenAt === 0) { touch(rec, t, 0); await persistSeen(rec); }
    reply(res, 200, { ok: true, nextPollSeconds: nextPollS(rec.ownerId, t) });
  }

  function nextQueued(ownerId) {
    let best = null;
    const t = now();
    jobs.forEach(j => { if (j.ownerId === ownerId && j.status === 'queued' && !j.writing && !(j.notBefore > t) && (!best || j.createdAt < best.createdAt)) best = j; });
    return best;
  }
  function waitForJob(ownerId, ms, res) {
    return new Promise(resolve => {
      const set = waiters.get(ownerId) || new Set();
      waiters.set(ownerId, set);
      let timer = null;
      const finish = () => {
        clearTimeout(timer);
        set.delete(finish);
        if (!set.size && waiters.get(ownerId) === set) waiters.delete(ownerId);
        res.removeListener('close', finish);
        resolve();
      };
      timer = setTimeout(finish, ms);
      set.add(finish);
      res.on('close', finish);
    });
  }

  async function claim(req, res) {
    const { rec, cold } = await workerOf(req);
    if (!limiters.claims.take(rec.id)) throw httpError(429, 'This token is polling too often.', 'too-many', { retryAfter: C.activePollS });
    const body = await readJson(req, L.SMALL_BODY);
    const once = body.once === true;
    const t0 = now();
    await sweep(t0);
    const announce = () => {
      const next = nextPollS(rec.ownerId, now());
      /* what the worker said it will wait if it finds nothing, when that is longer: the status "is the PC alive" uses it */
      const waits = Number.isFinite(body.waitSeconds) ? Math.max(0, Math.min(86400, Math.round(body.waitSeconds))) : 0;
      return { next: next, announced: once ? 0 : Math.max(next, waits) };
    };
    let a = announce();
    touch(rec, t0, a.announced);
    if (cold) await persistSeen(rec);

    let job = nextQueued(rec.ownerId);
    /* with a job in sight (queued, claimed, or just finished) a poll waits a little for one to arrive; an idle poll never waits */
    if (!job && !once && isActive(rec.ownerId, t0) && C.longPollMs > 0) {
      await waitForJob(rec.ownerId, Math.min(C.longPollMs, 25000), res);
      if (res.destroyed || res.writableEnded) return;
      /* the token may have been replaced, or the link removed, while it waited */
      if (!alive(rec)) throw httpError(401, 'That token is not valid.', 'bad-token');
      job = nextQueued(rec.ownerId);
    }
    if (!job) {
      a = announce();
      touch(rec, now(), a.announced);
      return reply(res, 200, { job: null, nextPollSeconds: a.next });
    }
    const t = now();
    const was = { status: job.status, attempts: job.attempts, workerId: job.workerId, claimedAt: job.claimedAt, beatAt: job.beatAt };
    job.status = 'claimed'; job.attempts += 1; job.workerId = rec.id; job.claimedAt = t; job.beatAt = t; job.progress = { stage: 'claimed', pct: 0 }; job.notBefore = 0;
    let won = false;
    await persist(() => Object.assign(job, was), async () => { won = await store.claimJob(job.id, rec.ownerId, rec.id, t); });
    if (!won) {
      /* the database says it was not queued any more: the memory was behind; read it all again on the next request */
      Object.assign(job, was);
      loaded = false;
      return reply(res, 200, { job: null, nextPollSeconds: C.activePollS });
    }
    a = announce();
    touch(rec, t, a.announced);
    await persistSeen(rec);
    reply(res, 200, { job: { id: job.id, url: job.url, title: job.title, attempt: job.attempts, maxAttempts: L.MAX_ATTEMPTS }, nextPollSeconds: a.next });
  }

  /* the job named in the path, if the token's link owns it and it is still the worker's to work on */
  async function workerJob(req, id, states) {
    const { rec, link, cold } = await workerOf(req);
    const job = jobs.get(id);
    if (!job || job.ownerId !== rec.ownerId) throw httpError(404, 'That job is not there.', 'not-found');
    if (states && states.indexOf(job.status) < 0) {
      throw httpError(409, job.status === 'cancelled' ? 'That job was cancelled.' : 'That job is not waiting for this any more.', job.status === 'cancelled' ? 'cancelled' : 'not-open', { status: job.status });
    }
    return { rec: rec, link: link, job: job, cold: cold };
  }

  async function heartbeat(req, res, id) {
    const { rec, job } = await workerJob(req, id, null);
    const body = await readJson(req, L.SMALL_BODY);
    const t = now();
    touch(rec, t, Math.max(rec.pollS, C.activePollS));
    if (job.status === 'cancelled') return reply(res, 200, { ok: true, cancelled: true, nextPollSeconds: C.activePollS });
    if (job.status !== 'claimed') throw httpError(409, 'That job is not claimed.', 'not-open', { status: job.status });
    job.beatAt = t;
    const pct = Number.isFinite(body.pct) ? Math.max(0, Math.min(1, body.pct)) : 0;
    const stage = typeof body.stage === 'string' && /^[a-z]{1,16}$/.test(body.stage) ? body.stage : 'working';
    job.progress = { stage: stage, pct: Math.round(pct * 1000) / 1000 };
    reply(res, 200, { ok: true, nextPollSeconds: C.activePollS });
  }

  async function postResult(req, res, id) {
    const { rec, link, job } = await workerJob(req, id, ['claimed', 'queued']);
    const body = await readJson(req, L.RESULT_BODY, L.RESULT_DRAIN);
    const v = R.validateResult(body);
    if (!v.ok) throw httpError(422, v.error, v.code || 'bad-result');
    /* the PC's work is never refused for the link's own share: the oldest finished conversions of this link are cleared to make room for it
       (a result is at most 2 MB and the share is 8 MB, so there is always room that way); only the site's total can say no */
    if (v.bytes > C.perUserResultBytes) throw httpError(503, 'This conversion is larger than one account may keep.', 'quota');
    await evict(rec.ownerId, v.bytes, 0);
    /* links are free to make and each has its own worker token, so what the links of one creating address hold together is bounded too (a result is refused, not made room for:
       the other links of that address are somebody else's to clear) */
    if (link.ipTag && addressBytes(link.ipTag) + v.bytes > C.perAddressResultBytes) throw httpError(503, 'This network has stored as many conversions as the site keeps for it. Remove some, or wait for them to expire.', 'quota');
    if (storedBytes() + v.bytes > C.totalResultBytes) throw httpError(503, 'The site cannot keep more notes right now.', 'busy');
    /* the body took a while to arrive, and so may the eviction: the token may have been replaced or the link removed, and the job may have been cancelled meanwhile */
    if (!alive(rec)) throw httpError(401, 'That token is not valid.', 'bad-token');
    if (job.status !== 'claimed' && job.status !== 'queued') throw httpError(409, job.status === 'cancelled' ? 'That job was cancelled.' : 'That job is not waiting for this any more.', job.status === 'cancelled' ? 'cancelled' : 'not-open', { status: job.status });
    const t = now();
    const was = { status: job.status, finishedAt: job.finishedAt, error: job.error, bytes: job.bytes, progress: job.progress };
    job.status = 'done'; job.finishedAt = t; job.error = ''; job.bytes = v.bytes; job.progress = null;
    const lf = lastFinished.get(job.ownerId) || 0;
    let ok = false;
    await persist(() => { Object.assign(job, was); lastFinished.set(job.ownerId, lf); }, async () => { ok = await store.finishJob(job.id, rec.ownerId, 'done', t, { result: v.result, bytes: v.bytes }); });
    if (!ok) { Object.assign(job, was); throw httpError(409, 'That job is not waiting for this any more.', 'not-open'); }
    lastFinished.set(job.ownerId, t);
    touch(rec, t, C.activePollS);
    await persistSeen(rec);
    reply(res, 200, { ok: true, nextPollSeconds: C.activePollS });
  }

  async function postFail(req, res, id) {
    const { rec, job } = await workerJob(req, id, ['claimed', 'queued']);
    const body = await readJson(req, L.SMALL_BODY);
    const error = R.cleanText(body.error, 200) || 'The PC could not convert this recording.';
    const t = now();
    if (body.retry === true && job.attempts < L.MAX_ATTEMPTS) {
      const was = { status: job.status, workerId: job.workerId, claimedAt: job.claimedAt, error: job.error, progress: job.progress, notBefore: job.notBefore };
      job.status = 'queued'; job.workerId = null; job.claimedAt = 0; job.error = error; job.progress = null;
      job.notBefore = t + (C.retryDelayMs != null ? C.retryDelayMs : L.RETRY_DELAY_MS) * job.attempts;
      let ok = false;
      await persist(() => Object.assign(job, was), async () => { ok = await store.requeueJob(job.id, rec.ownerId, error); });
      if (!ok) { Object.assign(job, was); throw httpError(409, 'That job is not waiting for this any more.', 'not-open'); }
      touch(rec, t, C.activePollS);
      return reply(res, 200, { ok: true, requeued: true, nextPollSeconds: C.activePollS });
    }
    const was = { status: job.status, finishedAt: job.finishedAt, error: job.error, progress: job.progress };
    const lf = lastFinished.get(job.ownerId) || 0;
    job.status = 'failed'; job.finishedAt = t; job.error = error; job.progress = null;
    let ok = false;
    await persist(() => { Object.assign(job, was); lastFinished.set(job.ownerId, lf); }, async () => { ok = await store.finishJob(job.id, rec.ownerId, 'failed', t, { error: error }); });
    if (!ok) { Object.assign(job, was); throw httpError(409, 'That job is not waiting for this any more.', 'not-open'); }
    lastFinished.set(job.ownerId, t);
    touch(rec, t, C.activePollS);
    await persistSeen(rec);
    reply(res, 200, { ok: true, nextPollSeconds: C.activePollS });
  }

  /* ================= routing ================= */
  function owns(p) {
    return p === '/api/jobs' || p.indexOf('/api/jobs/') === 0 || p.indexOf('/api/worker/') === 0 || p === '/api/pc-links' || p.indexOf('/api/pc-links/') === 0;
  }

  async function route(req, res, url) {
    const m = req.method, p = url.pathname;
    let g;
    if (p === '/api/pc-links') {
      if (m === 'POST') return createLink(req, res);
    } else if (p === '/api/pc-links/me') {
      if (m === 'DELETE') return revokeLink(req, res);
    } else if (p === '/api/pc-links/me/worker-token') {
      if (m === 'POST') return rotateToken(req, res);
    } else if (p === '/api/jobs') {
      if (m === 'GET') return listJobs(req, res);
      if (m === 'POST') return enqueue(req, res);
    } else if ((g = /^\/api\/jobs\/([A-Za-z0-9_-]{8,40})$/.exec(p))) {
      if (m === 'GET') return getJob(req, res, g[1]);
      if (m === 'DELETE') return deleteJob(req, res, g[1]);
    } else if ((g = /^\/api\/jobs\/([A-Za-z0-9_-]{8,40})\/cancel$/.exec(p))) {
      if (m === 'POST') return cancelJob(req, res, g[1]);
    } else if (p === '/api/worker/status') {
      if (m === 'GET') return workerStatus(req, res);
    } else if (p === '/api/worker/ping') {
      if (m === 'GET') return ping(req, res);
    } else if (p === '/api/worker/claim') {
      if (m === 'POST') return claim(req, res);
    } else if ((g = /^\/api\/worker\/jobs\/([A-Za-z0-9_-]{8,40})\/(result|fail|heartbeat)$/.exec(p))) {
      if (m === 'POST') return g[2] === 'result' ? postResult(req, res, g[1]) : g[2] === 'fail' ? postFail(req, res, g[1]) : heartbeat(req, res, g[1]);
    } else {
      return deps.jsonError(res, 404, 'Not found');
    }
    return deps.jsonError(res, 405, 'Method not allowed');
  }

  /* resolves when the request has been answered; never rejects */
  async function handle(req, res, url) {
    /* a queue that is off answers every one of its routes like a store that cannot be reached - and says that it is not a passing failure, so the page can
       leave the button and the settings card out (nothing is read or written: there may be no tables) */
    if (disabledWhy) return deps.send(res, 503, { error: 'The queue is not available right now. Try again in a minute.', code: 'store', disabled: true }, { 'Cache-Control': 'no-store' });
    try {
      await route(req, res, url);
    } catch (e) {
      if (e && e.http) {
        const h = e.http;
        const headers = h.extra && h.extra.retryAfter ? { 'Retry-After': String(h.extra.retryAfter) } : {};
        if (!res.headersSent) deps.send(res, h.status, Object.assign({ error: e.message }, h.code ? { code: h.code } : {}, h.extra && h.extra.status ? { status: h.extra.status } : {}), Object.assign({ 'Cache-Control': 'no-store' }, headers));
        return;
      }
      logError(e);
      if (!res.headersSent) {
        /* a store that cannot be reached is "try again", not a bug */
        deps.send(res, 503, { error: 'The queue is not available right now. Try again in a minute.', code: 'store' }, { 'Cache-Control': 'no-store' });
      }
    }
  }

  return {
    owns: owns, handle: handle, config: C,
    /* switch the whole queue off for this run (every route answers 503 "store"), with the reason for the log; there is no switching back on: a restart tries again */
    disable: why => { disabledWhy = String(why || 'disabled'); },
    isDisabled: () => !!disabledWhy,
    /* for tests */
    _state: { jobs: jobs, tokens: tokens, links: links, limiters: limiters, stats: stats, config: C, isLoaded: () => loaded, forgetAll: () => { loaded = false; }, purge: t => purgeIfDue(t, true), sweep: t => { lastSweep = 0; return sweep(t); } }
  };
}

module.exports = { create, LIMITS, configFrom, newToken, parseToken, newLink, codeHash, linkIdOf, addrKey, CODE_RE, PC_HEADER };
