/* G10b-1: where the home-PC worker's jobs and tokens are kept (the rules are in home-jobs.js).

   Two stores with the same methods: a Postgres one (production; `query(sql, params)` is the pool's) and a file one (a local
   server and the tests: data/jobs.json). The service keeps the queue in memory and calls these only to make a change
   durable, or once after a boot to read what was there (loadAll); an idle poll calls none of them.

   Every change names its owner in the WHERE clause (and the state it expects), so a job can only be changed by the account
   it belongs to, whatever the caller got wrong, and two writers cannot both win a claim. Every statement is parameterized.

   Times are milliseconds since the epoch here, and TIMESTAMPTZ in the database. A job is
     { id, ownerId, kind, url, title, status, attempts, workerId, createdAt, claimedAt, finishedAt, error, bytes }
   (the notes are not part of it: they are only written by finishJob and read by getResult). A token is
     { id, ownerId, hash, label, createdAt, lastSeenAt, pollS, revokedAt }. */
'use strict';
const fs = require('fs');
const path = require('path');

/* Additive and idempotent: CREATE ... IF NOT EXISTS only, nothing is altered or dropped. Run at every boot, after the
   tables it points at (ppp_users). Dropping the two tables is the whole of a rollback. */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ppp_transcribe_jobs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'youtube',
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    worker_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '',
    result JSONB,
    bytes INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT ppp_transcribe_jobs_status CHECK (status IN ('queued', 'claimed', 'done', 'failed', 'cancelled', 'expired'))
  );
  CREATE INDEX IF NOT EXISTS ppp_transcribe_jobs_owner ON ppp_transcribe_jobs (owner_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS ppp_worker_tokens (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    poll_s INTEGER NOT NULL DEFAULT 0,
    revoked_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS ppp_worker_tokens_owner ON ppp_worker_tokens (owner_id);
`;

const ms = v => (v == null ? 0 : (v instanceof Date ? v.getTime() : Date.parse(v)) || 0);
const at = t => new Date(t);

const JOB_COLS = 'id, owner_id, kind, url, title, status, attempts, worker_id, created_at, claimed_at, finished_at, error, bytes';
const TOKEN_COLS = 'id, owner_id, token_hash, label, created_at, last_seen_at, poll_s, revoked_at';

function jobOfRow(r) {
  return {
    id: r.id, ownerId: r.owner_id, kind: r.kind, url: r.url, title: r.title, status: r.status, attempts: r.attempts,
    workerId: r.worker_id || null, createdAt: ms(r.created_at), claimedAt: ms(r.claimed_at), finishedAt: ms(r.finished_at),
    error: r.error || '', bytes: r.bytes || 0
  };
}
function tokenOfRow(r) {
  return {
    id: r.id, ownerId: r.owner_id, hash: r.token_hash, label: r.label, createdAt: ms(r.created_at),
    lastSeenAt: ms(r.last_seen_at), pollS: r.poll_s || 0, revokedAt: ms(r.revoked_at)
  };
}

/* ---------------- Postgres ---------------- */
function pgJobStore(query) {
  const rowsOf = r => (r && r.rows) || [];
  return {
    kind: 'pg',
    /* the one read of a boot: the live tokens, and every job without its notes (a few hundred bytes each) - one round trip */
    async loadAll() {
      const r = await query(
        'SELECT ' + TOKEN_COLS + ' FROM ppp_worker_tokens WHERE revoked_at IS NULL;'
        + ' SELECT ' + JOB_COLS + ' FROM ppp_transcribe_jobs;');
      const parts = Array.isArray(r) ? r : [r];
      return { tokens: rowsOf(parts[0]).map(tokenOfRow), jobs: rowsOf(parts[1]).map(jobOfRow) };
    },
    async insertJob(j) {
      await query(
        'INSERT INTO ppp_transcribe_jobs (id, owner_id, kind, url, title, status, attempts, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [j.id, j.ownerId, j.kind, j.url, j.title, 'queued', 0, at(j.createdAt)]);
    },
    /* queued -> claimed; false when it was not queued any more (another writer got it, or it was cancelled) */
    async claimJob(id, ownerId, workerId, t) {
      const r = await query(
        "UPDATE ppp_transcribe_jobs SET status = 'claimed', attempts = attempts + 1, worker_id = $3, claimed_at = $4, error = '' WHERE id = $1 AND owner_id = $2 AND status = 'queued'",
        [id, ownerId, workerId, at(t)]);
      return (r.rowCount || 0) === 1;
    },
    /* claimed -> queued again (a failed attempt that may be tried again, or a lease that ran out) */
    async requeueJob(id, ownerId, error) {
      const r = await query(
        "UPDATE ppp_transcribe_jobs SET status = 'queued', worker_id = NULL, claimed_at = NULL, error = $3 WHERE id = $1 AND owner_id = $2 AND status = 'claimed'",
        [id, ownerId, error || '']);
      return (r.rowCount || 0) === 1;
    },
    /* queued or claimed -> done / failed / expired; result (the validated notes) only for done */
    async finishJob(id, ownerId, status, t, o) {
      o = o || {};
      const r = await query(
        "UPDATE ppp_transcribe_jobs SET status = $3, finished_at = $4, error = $5, result = $6, bytes = $7 WHERE id = $1 AND owner_id = $2 AND status IN ('claimed', 'queued')",
        [id, ownerId, status, at(t), o.error || '', o.result == null ? null : JSON.stringify(o.result), o.bytes || 0]);
      return (r.rowCount || 0) === 1;
    },
    async cancelJob(id, ownerId, t) {
      const r = await query(
        "UPDATE ppp_transcribe_jobs SET status = 'cancelled', finished_at = $3 WHERE id = $1 AND owner_id = $2 AND status IN ('queued', 'claimed')",
        [id, ownerId, at(t)]);
      return (r.rowCount || 0) === 1;
    },
    async deleteJobs(ids) {
      if (!ids.length) return 0;
      const r = await query('DELETE FROM ppp_transcribe_jobs WHERE id = ANY($1::text[])', [ids]);
      return r.rowCount || 0;
    },
    async getResult(id, ownerId) {
      const r = await query("SELECT result FROM ppp_transcribe_jobs WHERE id = $1 AND owner_id = $2 AND status = 'done'", [id, ownerId]);
      const row = rowsOf(r)[0];
      return row && row.result ? row.result : null;
    },
    async purge(doneBefore, otherBefore) {
      const r = await query(
        "DELETE FROM ppp_transcribe_jobs WHERE (status = 'done' AND finished_at < $1) OR (status IN ('failed', 'cancelled', 'expired') AND finished_at < $2)",
        [at(doneBefore), at(otherBefore)]);
      return r.rowCount || 0;
    },
    async insertToken(k) {
      await query(
        'INSERT INTO ppp_worker_tokens (id, owner_id, token_hash, label, created_at, poll_s) VALUES ($1, $2, $3, $4, $5, 0)',
        [k.id, k.ownerId, k.hash, k.label, at(k.createdAt)]);
    },
    async revokeToken(id, ownerId, t) {
      const r = await query('UPDATE ppp_worker_tokens SET revoked_at = $3 WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL', [id, ownerId, at(t)]);
      return (r.rowCount || 0) === 1;
    },
    async touchSeen(id, ownerId, t, pollS) {
      await query('UPDATE ppp_worker_tokens SET last_seen_at = $3, poll_s = $4 WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL', [id, ownerId, at(t), pollS | 0]);
    }
  };
}

/* ---------------- a file (local server, tests) ---------------- */
function fileJobStore(dir) {
  const file = path.join(dir, 'jobs.json');
  function load() {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { jobs: Array.isArray(d.jobs) ? d.jobs : [], tokens: Array.isArray(d.tokens) ? d.tokens : [] };
    } catch (e) { return { jobs: [], tokens: [] }; }
  }
  function save(d) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d));
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); return; } catch (e) {
        /* Windows: a scanner or another process can hold the file for a moment; the same rename a few milliseconds later works */
        if (i >= 8 || !/^(EPERM|EBUSY|EACCES)$/.test(String(e && e.code))) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 + i * 10);
      }
    }
  }
  const plain = r => { const o = Object.assign({}, r); delete o.result; return o; };
  const find = (d, id, ownerId) => d.jobs.find(j => j.id === id && j.ownerId === ownerId);
  return {
    kind: 'file',
    async loadAll() {
      const d = load();
      return { tokens: d.tokens.filter(k => !k.revokedAt).map(k => Object.assign({}, k)), jobs: d.jobs.map(plain) };
    },
    async insertJob(j) {
      const d = load();
      d.jobs.push({ id: j.id, ownerId: j.ownerId, kind: j.kind, url: j.url, title: j.title, status: 'queued', attempts: 0, workerId: null,
        createdAt: j.createdAt, claimedAt: 0, finishedAt: 0, error: '', bytes: 0, result: null });
      save(d);
    },
    async claimJob(id, ownerId, workerId, t) {
      const d = load(), j = find(d, id, ownerId);
      if (!j || j.status !== 'queued') return false;
      Object.assign(j, { status: 'claimed', attempts: j.attempts + 1, workerId: workerId, claimedAt: t, error: '' });
      save(d);
      return true;
    },
    async requeueJob(id, ownerId, error) {
      const d = load(), j = find(d, id, ownerId);
      if (!j || j.status !== 'claimed') return false;
      Object.assign(j, { status: 'queued', workerId: null, claimedAt: 0, error: error || '' });
      save(d);
      return true;
    },
    async finishJob(id, ownerId, status, t, o) {
      o = o || {};
      const d = load(), j = find(d, id, ownerId);
      if (!j || (j.status !== 'claimed' && j.status !== 'queued')) return false;
      Object.assign(j, { status: status, finishedAt: t, error: o.error || '', result: o.result == null ? null : o.result, bytes: o.bytes || 0 });
      save(d);
      return true;
    },
    async cancelJob(id, ownerId, t) {
      const d = load(), j = find(d, id, ownerId);
      if (!j || (j.status !== 'claimed' && j.status !== 'queued')) return false;
      Object.assign(j, { status: 'cancelled', finishedAt: t });
      save(d);
      return true;
    },
    async deleteJobs(ids) {
      const d = load(), n = d.jobs.length;
      d.jobs = d.jobs.filter(j => ids.indexOf(j.id) < 0);
      if (d.jobs.length !== n) save(d);
      return n - d.jobs.length;
    },
    async getResult(id, ownerId) {
      const j = find(load(), id, ownerId);
      return j && j.status === 'done' && j.result ? j.result : null;
    },
    async purge(doneBefore, otherBefore) {
      const d = load(), n = d.jobs.length;
      d.jobs = d.jobs.filter(j => !((j.status === 'done' && j.finishedAt < doneBefore)
        || ((j.status === 'failed' || j.status === 'cancelled' || j.status === 'expired') && j.finishedAt < otherBefore)));
      if (d.jobs.length !== n) save(d);
      return n - d.jobs.length;
    },
    async insertToken(k) {
      const d = load();
      d.tokens.push({ id: k.id, ownerId: k.ownerId, hash: k.hash, label: k.label, createdAt: k.createdAt, lastSeenAt: 0, pollS: 0, revokedAt: 0 });
      save(d);
    },
    async revokeToken(id, ownerId, t) {
      const d = load(), k = d.tokens.find(x => x.id === id && x.ownerId === ownerId && !x.revokedAt);
      if (!k) return false;
      k.revokedAt = t;
      save(d);
      return true;
    },
    async touchSeen(id, ownerId, t, pollS) {
      const d = load(), k = d.tokens.find(x => x.id === id && x.ownerId === ownerId && !x.revokedAt);
      if (!k) return;
      k.lastSeenAt = t; k.pollS = pollS | 0;
      save(d);
    }
  };
}

module.exports = { SCHEMA_SQL, pgJobStore, fileJobStore, jobOfRow, tokenOfRow };
