/* G10b-1: the home-PC transcription queue (docs/GOALS/G10B_HOME_WORKER.md).

   A signed-in person asks the site to transcribe a YouTube link with the strong piano models (the helper ensemble, TransKun +
   Kong). The site cannot run them for free, so it only keeps the QUEUE: a worker script on that person's own PC polls the site
   with a token, claims the job, downloads the audio, runs transcribe.py on the PC's GPU and posts the notes back
   (tools/home-worker/). The page then writes the notation from those notes in the browser, as it does for the browser model's.

   What this module is, and is not:
     - the routes (server.js hands every /api/jobs... and /api/worker/... request to handle()), the rules, the in-memory queue;
     - the DATABASE is only the durable copy (home-jobs-store.js): it is written on enqueue, claim, finish, fail, cancel,
       purge, token create/revoke, and read ONCE after a boot (the first request that needs the queue). A poll that finds
       nothing to do answers from memory and runs no SQL at all (Neon's compute hours; tests/home-worker/ counts the queries);
     - ONE instance. The queue lives in this process: a second instance would not see the first one's claims in memory. The SQL
       guards (a claim only moves a row that is still queued) keep the data right if that ever happens, but the long-poll and
       "is the PC alive" would not. Render's free plan runs one instance; scaling out means moving the queue into the database.

   The server tells the worker how long to wait (nextPollSeconds in every worker answer): 15 s while the person has a job
   queued or claimed or one finished in the last 5 minutes, otherwise 20 minutes (PPP_WORKER_IDLE_POLL_S). Every request wakes
   the free instance for 15 minutes, so a worker that polled every minute would keep it awake all month.

   Authentication: the browser routes use the account's session cookie (signed in only: a guest key is not an account), the
   worker routes a bearer token the person made on the site. A token is 32 random bytes, shown once; only its sha256 is kept,
   compared in constant time. A token can only claim and complete the jobs of its own account, checked in memory and in SQL. */
'use strict';
const crypto = require('crypto');
const guestShare = require('./share-guest');
const R = require('./home-result');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIMITS = {
  /* the queue */
  PENDING_PER_USER: 5,
  ROWS_PER_USER: 30,
  TOKENS_PER_USER: 5,
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
  SWEEP_EVERY_MS: 10 * 1000,
  /* request bodies */
  JOB_BODY: 4 * 1024,
  SMALL_BODY: 4 * 1024,
  RESULT_BODY: R.LIMITS.RESULT_MAX_BYTES + 1024 * 1024,
  RESULT_DRAIN: 8 * 1024 * 1024,
  /* rates */
  ENQUEUE_PER_HOUR: 30,
  ENQUEUE_ALL_PER_HOUR: 200,
  TOKENS_PER_HOUR: 10,
  CLAIMS_PER_HOUR: 600,
  BAD_TOKENS_PER_HOUR: 20,
  /* the account is looked up once and then remembered this long (the session cookie itself is signed and expires) */
  USER_CACHE_MS: 10 * 60 * 1000
};

function configFrom(env, over) {
  const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return Object.assign({
    idlePollS: int(env.PPP_WORKER_IDLE_POLL_S, 1200, 60, 86400),
    activePollS: int(env.PPP_WORKER_ACTIVE_POLL_S, 15, 5, 300),
    /* after something finished, this long the worker is still asked to come back soon (the next job of a batch) */
    activeTailMs: 5 * 60 * 1000,
    /* a poll with work in sight waits this long for a job to arrive; with nothing in sight it returns at once */
    longPollMs: 25 * 1000
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
  const tokens = new Map();        /* id -> live token (hash as a Buffer) */
  const waiters = new Map();       /* ownerId -> Set<function> : long-polls waiting for a job */
  const lastFinished = new Map();  /* ownerId -> ms of the last done/failed */
  const userCache = new Map();     /* uid -> { user, until } */
  let loaded = false, loading = null, lastSweep = 0, lastPurge = 0;
  const stats = { loads: 0 };

  const limiters = {
    enqueue: guestShare.slidingWindow(L.ENQUEUE_PER_HOUR, HOUR),
    enqueueAll: guestShare.slidingWindow(L.ENQUEUE_ALL_PER_HOUR, HOUR),
    tokens: guestShare.slidingWindow(L.TOKENS_PER_HOUR, HOUR),
    claims: guestShare.slidingWindow(L.CLAIMS_PER_HOUR, HOUR),
    badTokens: guestShare.slidingWindow(L.BAD_TOKENS_PER_HOUR, HOUR)
  };

  function fill(data) {
    jobs.clear(); tokens.clear(); lastFinished.clear();
    data.jobs.forEach(j => {
      jobs.set(j.id, Object.assign({ beatAt: 0, progress: null }, j));
      if ((j.status === 'done' || j.status === 'failed') && j.finishedAt > (lastFinished.get(j.ownerId) || 0)) lastFinished.set(j.ownerId, j.finishedAt);
    });
    data.tokens.forEach(k => {
      if (k.revokedAt) return;
      tokens.set(k.id, { id: k.id, ownerId: k.ownerId, hash: Buffer.from(String(k.hash), 'hex'), label: k.label, createdAt: k.createdAt,
        lastSeenAt: k.lastSeenAt || 0, pollS: k.pollS || 0 });
    });
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
  async function userOf(req) {
    const uid = deps.sessionUid(req);
    if (!uid) return null;
    const t = now();
    const hit = userCache.get(uid);
    if (hit && hit.until > t) return hit.user;
    const user = await deps.findUser(uid);
    if (!user) { userCache.delete(uid); return null; }
    if (userCache.size > 2000) userCache.clear();
    userCache.set(uid, { user: { id: user.id, displayName: user.displayName }, until: t + L.USER_CACHE_MS });
    return userCache.get(uid).user;
  }
  async function requireUser(req) {
    const user = await userOf(req);
    if (!user) throw httpError(401, 'Sign in to use this.', 'sign-in');
    return user;
  }
  /* a browser request that changes something must come from this site: a page of another origin cannot ask for it with the
     person's cookie (the cookie is SameSite=Lax as well) */
  function sameSite(req) {
    const origin = req.headers.origin;
    if (origin == null) return true;
    try { return !!req.headers.host && new URL(String(origin)).host === req.headers.host; } catch (e) { return false; }
  }
  function requireSameSite(req) {
    if (!sameSite(req)) throw httpError(403, 'That request did not come from this site.', 'cross-site');
  }
  function authWorker(req) {
    const ip = deps.clientIp(req) || 'unknown';
    const t = parseToken(req.headers.authorization);
    if (!limiters.badTokens.peek(ip)) throw httpError(429, 'Too many wrong tokens from here. Try again later.', 'too-many', { retryAfter: 600 });
    const bad = () => { limiters.badTokens.take(ip); return httpError(401, 'That token is not valid.', 'bad-token'); };
    if (!t) throw bad();
    return t;
  }
  /* the token's record, or null. The id picks the record (it is not secret); the secret is checked by comparing hashes in
     constant time, and a token that does not exist is compared against a dummy so the time does not tell. */
  function verifyToken(t) {
    const rec = tokens.get(t.id) || null;
    const want = rec ? rec.hash : DUMMY_HASH;
    const got = sha256(t.token);
    const same = want.length === got.length && crypto.timingSafeEqual(want, got);
    return same && rec ? rec : null;
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
  }
  /* write the token's last-seen time to the database: only where the database is being used anyway */
  async function persistSeen(rec) {
    try { await store.touchSeen(rec.id, rec.ownerId, rec.lastSeenAt, rec.pollS); } catch (e) { logError(e); }
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

  /* Finished rows past their keeping time leave memory and the database. The DELETE runs only when memory says there is something to delete. */
  async function purgeIfDue(t, force) {
    if (!force && t - lastPurge < L.PURGE_EVERY_MS) return;
    lastPurge = t;
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

  /* ================= browser routes (the account's cookie) ================= */

  async function listJobs(req, res) {
    const user = await requireUser(req);
    await ensureLoaded();
    const t = now();
    await sweep(t);
    const list = ownJobs(user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, L.ROWS_PER_USER).map(publicJob);
    reply(res, 200, { jobs: list, worker: workerSummary(user.id, t) });
  }

  async function enqueue(req, res) {
    requireSameSite(req);
    const user = await requireUser(req);
    if (!limiters.enqueue.take(user.id)) throw httpError(429, 'Too many conversions were asked for just now. Try again in a little while.', 'too-many', { retryAfter: 600 });
    if (!limiters.enqueueAll.take('all')) { limiters.enqueue.release(user.id); throw httpError(429, 'Too many conversions were asked for just now. Try again in a little while.', 'too-many', { retryAfter: 600 }); }
    const body = await readJson(req, L.JOB_BODY);
    const parsed = parseYoutube(body.url);
    if (!parsed) { limiters.enqueue.release(user.id); limiters.enqueueAll.release('all'); throw httpError(422, 'That is not a link to a YouTube video.', 'bad-url'); }
    await ensureLoaded();
    const t = now();
    await sweep(t);
    await purgeIfDue(t);
    const mine = ownJobs(user.id);
    const dup = mine.find(j => pending(j) && j.url === parsed.url);
    if (dup) { limiters.enqueue.release(user.id); limiters.enqueueAll.release('all'); return reply(res, 200, { job: publicJob(dup), existing: true, worker: workerSummary(user.id, t) }); }
    if (mine.filter(pending).length >= L.PENDING_PER_USER) {
      limiters.enqueue.release(user.id); limiters.enqueueAll.release('all');
      throw httpError(429, 'You already have ' + L.PENDING_PER_USER + ' conversions waiting. Wait for one to finish, or cancel one.', 'queue-full');
    }
    if (jobs.size >= L.MAX_ROWS) { limiters.enqueue.release(user.id); limiters.enqueueAll.release('all'); throw httpError(503, 'The queue is full right now. Try again later.', 'busy'); }
    /* room for it among the person's rows: the oldest finished ones go first */
    if (mine.length >= L.ROWS_PER_USER) {
      const old = mine.filter(j => !pending(j)).sort((a, b) => (a.finishedAt || a.createdAt) - (b.finishedAt || b.createdAt)).slice(0, mine.length - L.ROWS_PER_USER + 1);
      if (old.length) { await store.deleteJobs(old.map(j => j.id)); old.forEach(j => jobs.delete(j.id)); }
    }
    const job = { id: crypto.randomBytes(12).toString('base64url'), ownerId: user.id, kind: 'youtube', url: parsed.url,
      title: R.cleanText(body.title, 120), status: 'queued', attempts: 0, workerId: null, createdAt: t, claimedAt: 0, finishedAt: 0, error: '', bytes: 0, beatAt: 0, progress: null };
    /* the slot is taken now, before the write is awaited (two requests at once cannot both pass the cap); nothing claims it until it is durable */
    job.writing = true;
    jobs.set(job.id, job);
    try { await store.insertJob(job); } catch (e) { jobs.delete(job.id); limiters.enqueue.release(user.id); limiters.enqueueAll.release('all'); throw e; }
    job.writing = false;
    wake(user.id);
    reply(res, 201, { job: publicJob(job), worker: workerSummary(user.id, t) });
  }

  async function ownJob(req, id) {
    const user = await requireUser(req);
    await ensureLoaded();
    const job = jobs.get(id);
    /* somebody else's job is not there at all */
    if (!job || job.ownerId !== user.id) throw httpError(404, 'That conversion is not there.', 'not-found');
    return { user: user, job: job };
  }

  async function getJob(req, res, id) {
    const { user, job } = await ownJob(req, id);
    await sweep(now());
    const out = { job: publicJob(job) };
    if (job.status === 'done') {
      const result = await store.getResult(job.id, user.id);
      if (!result) throw httpError(410, 'The notes of that conversion are no longer kept.', 'gone');
      out.result = result;
    }
    reply(res, 200, out);
  }

  async function cancelJob(req, res, id) {
    requireSameSite(req);
    const { user, job } = await ownJob(req, id);
    if (job.status === 'cancelled') return reply(res, 200, { job: publicJob(job) });
    if (!pending(job)) throw httpError(409, 'That conversion has already finished.', 'finished');
    const t = now();
    const was = { status: job.status, finishedAt: job.finishedAt };
    job.status = 'cancelled'; job.finishedAt = t; job.progress = null;
    await persist(() => Object.assign(job, was), async () => {
      /* false: the row was not queued or claimed any more (finished at the same moment); the memory is put right below */
      if (!(await store.cancelJob(job.id, user.id, t))) { Object.assign(job, was); throw httpError(409, 'That conversion has already finished.', 'finished'); }
    });
    reply(res, 200, { job: publicJob(job) });
  }

  async function workerStatus(req, res) {
    const user = await requireUser(req);
    await ensureLoaded();
    reply(res, 200, { worker: workerSummary(user.id, now()) });
  }

  async function listTokens(req, res) {
    const user = await requireUser(req);
    await ensureLoaded();
    const t = now();
    const list = [];
    tokens.forEach(k => {
      if (k.ownerId !== user.id) return;
      list.push({ id: k.id, label: k.label, createdAt: iso(k.createdAt), lastSeenAt: iso(k.lastSeenAt),
        alive: k.lastSeenAt > 0 && t - k.lastSeenAt <= Math.max(2 * k.pollS, 120) * 1000 + 30000 });
    });
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    reply(res, 200, { tokens: list, worker: workerSummary(user.id, t) });
  }

  async function createToken(req, res) {
    requireSameSite(req);
    const user = await requireUser(req);
    if (!limiters.tokens.take(user.id)) throw httpError(429, 'Too many tokens were made just now. Try again later.', 'too-many', { retryAfter: 600 });
    const body = await readJson(req, L.SMALL_BODY);
    await ensureLoaded();
    let n = 0;
    tokens.forEach(k => { if (k.ownerId === user.id) n++; });
    if (n >= L.TOKENS_PER_USER) { limiters.tokens.release(user.id); throw httpError(429, 'You have ' + L.TOKENS_PER_USER + ' PC tokens already. Remove one first.', 'too-many-tokens'); }
    const k = newToken();
    const rec = { id: k.id, ownerId: user.id, hash: Buffer.from(k.hash, 'hex'), label: R.cleanText(body.label, 40) || 'My PC', createdAt: now(), lastSeenAt: 0, pollS: 0 };
    tokens.set(rec.id, rec);   /* counted at once; the token is not shown to anyone until it is stored */
    try { await store.insertToken({ id: rec.id, ownerId: rec.ownerId, hash: k.hash, label: rec.label, createdAt: rec.createdAt }); }
    catch (e) { tokens.delete(rec.id); limiters.tokens.release(user.id); throw e; }
    /* the only time the token is ever shown */
    reply(res, 201, { id: rec.id, token: k.token, label: rec.label, createdAt: iso(rec.createdAt) });
  }

  async function revokeToken(req, res, id) {
    requireSameSite(req);
    const user = await requireUser(req);
    await ensureLoaded();
    const rec = tokens.get(id);
    if (!rec || rec.ownerId !== user.id) throw httpError(404, 'That token is not there.', 'not-found');
    tokens.delete(id);
    try {
      if (!(await store.revokeToken(id, user.id, now()))) { /* already revoked elsewhere: it is gone either way */ }
    } catch (e) { tokens.set(id, rec); throw e; }
    reply(res, 200, { ok: true });
  }

  /* ================= worker routes (a bearer token) ================= */

  async function workerOf(req) {
    const t = authWorker(req);
    const cold = await ensureLoaded();
    const rec = verifyToken(t);
    if (!rec) { limiters.badTokens.take(deps.clientIp(req) || 'unknown'); throw httpError(401, 'That token is not valid.', 'bad-token'); }
    return { rec: rec, cold: cold };
  }

  async function ping(req, res) {
    const { rec, cold } = await workerOf(req);
    const t = now();
    touch(rec, t, C.idlePollS);
    if (cold) await persistSeen(rec);
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

  /* the job named in the path, if the token's account owns it and it is still the worker's to work on */
  async function workerJob(req, id, states) {
    const { rec, cold } = await workerOf(req);
    const job = jobs.get(id);
    if (!job || job.ownerId !== rec.ownerId) throw httpError(404, 'That job is not there.', 'not-found');
    if (states && states.indexOf(job.status) < 0) {
      throw httpError(409, job.status === 'cancelled' ? 'That job was cancelled.' : 'That job is not waiting for this any more.', job.status === 'cancelled' ? 'cancelled' : 'not-open', { status: job.status });
    }
    return { rec: rec, job: job, cold: cold };
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
    const { rec, job } = await workerJob(req, id, ['claimed', 'queued']);
    const body = await readJson(req, L.RESULT_BODY, L.RESULT_DRAIN);
    const v = R.validateResult(body);
    if (!v.ok) throw httpError(422, v.error, v.code || 'bad-result');
    /* the body took a while to arrive: the job may have been cancelled meanwhile */
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
    return p === '/api/jobs' || p.indexOf('/api/jobs/') === 0 || p.indexOf('/api/worker/') === 0;
  }

  async function route(req, res, url) {
    const m = req.method, p = url.pathname;
    let g;
    if (p === '/api/jobs') {
      if (m === 'GET') return listJobs(req, res);
      if (m === 'POST') return enqueue(req, res);
    } else if ((g = /^\/api\/jobs\/([A-Za-z0-9_-]{8,40})$/.exec(p))) {
      if (m === 'GET') return getJob(req, res, g[1]);
    } else if ((g = /^\/api\/jobs\/([A-Za-z0-9_-]{8,40})\/cancel$/.exec(p))) {
      if (m === 'POST') return cancelJob(req, res, g[1]);
    } else if (p === '/api/worker/status') {
      if (m === 'GET') return workerStatus(req, res);
    } else if (p === '/api/worker/tokens') {
      if (m === 'GET') return listTokens(req, res);
      if (m === 'POST') return createToken(req, res);
    } else if ((g = /^\/api\/worker\/tokens\/([A-Za-z0-9_-]{12})$/.exec(p))) {
      if (m === 'DELETE') return revokeToken(req, res, g[1]);
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
    owns: owns, handle: handle,
    /* for tests */
    _state: { jobs: jobs, tokens: tokens, limiters: limiters, stats: stats, config: C, isLoaded: () => loaded, forgetAll: () => { loaded = false; userCache.clear(); }, purge: t => purgeIfDue(t, true), sweep: t => { lastSweep = 0; return sweep(t); } }
  };
}

module.exports = { create, LIMITS, configFrom, newToken, parseToken };
